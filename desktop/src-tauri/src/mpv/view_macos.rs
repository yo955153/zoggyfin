//! The video surface on macOS: a CAOpenGLLayer that libmpv draws into with
//! its render API (the approach IINA uses). The layer's view sits under the
//! WKWebView in the window's content view. The web view is transparent where
//! the player is, so the web controls draw over the video.

// Apple marks OpenGL as deprecated. It still works, and libmpv's render API needs it.
#![allow(deprecated)]

use std::ffi::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::Arc;

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow, NSWindowOrderingMode};
use objc2_core_foundation::CFTimeInterval;
use objc2_core_video::CVTimeStamp;
use objc2_foundation::NSObject;
use objc2_open_gl::{CGLChoosePixelFormat, CGLContextObj, CGLPixelFormatAttribute, CGLPixelFormatObj};
use objc2_quartz_core::{CALayer, CAOpenGLLayer};

use super::ffi::*;
use super::player::Mpv;

const GL_DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
const GL_VIEWPORT: u32 = 0x0BA2;
const GL_COLOR_BUFFER_BIT: u32 = 0x4000;

#[link(name = "OpenGL", kind = "framework")]
extern "C" {
    fn glGetIntegerv(pname: u32, data: *mut i32);
    fn glClearColor(r: f32, g: f32, b: f32, a: f32);
    fn glClear(mask: u32);
    fn glFlush();
}

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    dlsym(RTLD_DEFAULT, name)
}

/// Set by libmpv's update callback (any thread); read by the layer.
unsafe extern "C" fn on_update(ctx: *mut c_void) {
    let flag = &*(ctx as *const AtomicBool);
    flag.store(true, Ordering::Release);
}

pub struct LayerIvars {
    mpv: Arc<Mpv>,
    render: AtomicPtr<mpv_render_context>,
    /// libmpv has a new frame (or wants a redraw).
    dirty: Box<AtomicBool>,
    /// Draw even without a new frame: after a resize or before the first frame.
    force: AtomicBool,
}

define_class!(
    // SAFETY: CAOpenGLLayer may be subclassed; the overrides keep the superclass signatures.
    #[unsafe(super(CAOpenGLLayer, CALayer, NSObject))]
    #[name = "ZoggyfinMpvLayer"]
    #[ivars = LayerIvars]
    pub struct MpvLayer;

    impl MpvLayer {
        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn copy_pixel_format(&self, _mask: u32) -> CGLPixelFormatObj {
            pixel_format()
        }

        #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn can_draw(
            &self,
            _ctx: CGLContextObj,
            _pf: CGLPixelFormatObj,
            _t: CFTimeInterval,
            _ts: *const CVTimeStamp,
        ) -> Bool {
            let iv = self.ivars();
            if iv.force.load(Ordering::Acquire) {
                return Bool::YES;
            }
            let render = iv.render.load(Ordering::Acquire);
            if render.is_null() {
                return Bool::YES;
            }
            if iv.dirty.swap(false, Ordering::AcqRel) {
                // SAFETY: called on the layer's drawing thread, the only thread that renders.
                let flags = unsafe { mpv_render_context_update(render) };
                if flags & MPV_RENDER_UPDATE_FRAME != 0 {
                    return Bool::YES;
                }
            }
            Bool::NO
        }

        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn draw(&self, ctx: CGLContextObj, pf: CGLPixelFormatObj, t: CFTimeInterval, ts: *const CVTimeStamp) {
            let iv = self.ivars();
            iv.force.store(false, Ordering::Release);
            // SAFETY: Core Animation made `ctx` current for this call.
            unsafe {
                let mut render = iv.render.load(Ordering::Acquire);
                if render.is_null() {
                    render = create_render_context(&iv.mpv, &iv.dirty);
                    iv.render.store(render, Ordering::Release);
                }
                let mut fbo: i32 = 0;
                glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &mut fbo);
                let mut vp = [0i32; 4];
                glGetIntegerv(GL_VIEWPORT, vp.as_mut_ptr());
                if render.is_null() || vp[2] <= 0 || vp[3] <= 0 {
                    glClearColor(0.0, 0.0, 0.0, 1.0);
                    glClear(GL_COLOR_BUFFER_BIT);
                } else {
                    let mut target = mpv_opengl_fbo { fbo, w: vp[2], h: vp[3], internal_format: 0 };
                    let mut flip: c_int = 1;
                    let mut params = [
                        mpv_render_param { type_: MPV_RENDER_PARAM_OPENGL_FBO, data: &mut target as *mut _ as *mut c_void },
                        mpv_render_param { type_: MPV_RENDER_PARAM_FLIP_Y, data: &mut flip as *mut _ as *mut c_void },
                        mpv_render_param { type_: MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
                    ];
                    mpv_render_context_render(render, params.as_mut_ptr());
                }
                glFlush();
                let _: () = msg_send![super(self), drawInCGLContext: ctx, pixelFormat: pf, forLayerTime: t, displayTime: ts];
                if !render.is_null() {
                    mpv_render_context_report_swap(render);
                }
            }
        }
    }
);

fn pixel_format() -> CGLPixelFormatObj {
    // kCGLPFAOpenGLProfile = 99, kCGLOGLPVersion_3_2_Core = 0x3200, kCGLPFADoubleBuffer = 5,
    // kCGLPFAAccelerated = 73, kCGLPFAAllowOfflineRenderers = 96,
    // kCGLPFASupportsAutomaticGraphicsSwitching = 101, kCGLPFAColorSize = 8.
    let attrs: [u32; 10] = [99, 0x3200, 5, 73, 96, 101, 8, 32, 0, 0];
    let mut pf: CGLPixelFormatObj = std::ptr::null_mut();
    let mut n: i32 = 0;
    // SAFETY: a zero-terminated attribute list and valid out pointers.
    unsafe {
        let attrs = std::ptr::NonNull::new(attrs.as_ptr() as *mut CGLPixelFormatAttribute).expect("attributes");
        CGLChoosePixelFormat(attrs, std::ptr::NonNull::from(&mut pf), std::ptr::NonNull::from(&mut n));
    }
    pf
}

/// Creates libmpv's OpenGL render context on the current CGL context.
unsafe fn create_render_context(mpv: &Mpv, dirty: &AtomicBool) -> *mut mpv_render_context {
    let mut init = mpv_opengl_init_params {
        get_proc_address: Some(get_proc_address),
        get_proc_address_ctx: std::ptr::null_mut(),
    };
    let mut params = [
        mpv_render_param {
            type_: MPV_RENDER_PARAM_API_TYPE,
            data: MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *mut c_void,
        },
        mpv_render_param {
            type_: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
            data: &mut init as *mut _ as *mut c_void,
        },
        mpv_render_param {
            type_: MPV_RENDER_PARAM_INVALID,
            data: std::ptr::null_mut(),
        },
    ];
    let mut ctx: *mut mpv_render_context = std::ptr::null_mut();
    if mpv_render_context_create(&mut ctx, mpv.raw(), params.as_mut_ptr()) < 0 {
        eprintln!("[mpv] the OpenGL render context could not start");
        return std::ptr::null_mut();
    }
    mpv_render_context_set_update_callback(ctx, Some(on_update), dirty as *const AtomicBool as *mut c_void);
    ctx
}

impl MpvLayer {
    fn create(mpv: Arc<Mpv>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(LayerIvars {
            mpv,
            render: AtomicPtr::new(std::ptr::null_mut()),
            dirty: Box::new(AtomicBool::new(false)),
            force: AtomicBool::new(true),
        });
        // SAFETY: plain NSObject init through the superclass.
        unsafe { msg_send![super(this), init] }
    }
}

/// The view that holds the layer, kept so the web app can show or hide it.
pub struct VideoView {
    view: Retained<NSView>,
    layer: Retained<MpvLayer>,
}

// SAFETY: the view is only touched on the main thread (see `with_main`).
unsafe impl Send for VideoView {}
unsafe impl Sync for VideoView {}

impl VideoView {
    /// Puts the video view under every other view of the window. Main thread only.
    pub fn attach(ns_window: *mut c_void, mpv: Arc<Mpv>) -> Option<Self> {
        let mtm = MainThreadMarker::new()?;
        // SAFETY: Tauri gives a valid NSWindow pointer for the window's life.
        let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
        let content = window.contentView()?;
        content.setWantsLayer(true);
        let layer = MpvLayer::create(mpv);
        let black = objc2_core_graphics::CGColor::new_generic_gray(0.0, 1.0);
        layer.setBackgroundColor(Some(&black));
        layer.setAsynchronous(true);
        layer.setNeedsDisplayOnBoundsChange(true);
        layer.setContentsScale(window.backingScaleFactor());
        let view = NSView::initWithFrame(NSView::alloc(mtm), content.bounds());
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        // A layer-hosting view: set the layer first, then ask for layers.
        view.setLayer(Some(&layer));
        view.setWantsLayer(true);
        content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
        Some(VideoView { view, layer })
    }

    /// Main thread only.
    pub fn set_visible(&self, visible: bool) {
        self.view.setHidden(!visible);
        // An asynchronous layer asks for frames at the display rate; stop that when hidden.
        self.layer.setAsynchronous(visible);
        self.layer.ivars().force.store(true, Ordering::Release);
        self.layer.setNeedsDisplay();
    }

    /// Main thread only: after the window moved to a screen with another scale.
    pub fn update_scale(&self) {
        if let Some(w) = self.view.window() {
            self.layer.setContentsScale(w.backingScaleFactor());
            self.layer.ivars().force.store(true, Ordering::Release);
        }
    }
}
