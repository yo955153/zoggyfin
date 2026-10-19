/**
 * Connects invites to the extension system: the admin's turned-on
 * extensions go into an invite, and a join offers them on the extension
 * system's confirm screen. Imported once by the root layout.
 */
import { extensionsForInvite, installFromInvite } from '@/extensions';

import { registerInviteExtensions } from './extensions';

registerInviteExtensions({ extensionsForInvite, installFromInvite });
