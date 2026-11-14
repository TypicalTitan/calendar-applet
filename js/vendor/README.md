# Third-party code

`firebase.js` is the Firebase JavaScript SDK (copyright Google LLC and contributors), bundled
from the `firebase` npm package at the version pinned in `package.json`, reduced to the
functions listed in `scripts/firebase-entry.js`. It is licensed under the Apache License,
Version 2.0; a copy is in `LICENSE-APACHE-2.0.txt`, and the original copyright notices are kept
inside the file. It is not modified by hand: `npm run vendor` regenerates it.
