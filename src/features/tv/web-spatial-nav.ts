/** Native TV has a focus engine of its own: nothing to install. See web-spatial-nav.web.ts. */
export function installWebSpatialNav(): () => void {
  return () => undefined;
}
