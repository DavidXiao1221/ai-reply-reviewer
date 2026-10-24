import { version } from '../package.json';

// Baked into each bundle: runtime.getManifest() alone cannot identify an old
// content script that remains in an already-open document after an update.
export const BUILD_VERSION = version;
export const READER_CHANNEL = `reply-review-reader/${BUILD_VERSION}`;
export const READER_FILE = 'content-scripts/reader.js';
