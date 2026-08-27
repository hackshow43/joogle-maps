# Joogle Maps

OpenStreetMap-based map app with saved places, search history, and shareable
routes, backed by Firebase — no login screen. Every visitor is signed in
**anonymously** the moment the page loads, so saves/history/shares just work
without ever asking for an email or password.

Trade-off worth knowing: an anonymous Firebase identity is tied to the
browser, not a person. Clearing site data, using a different browser, or
switching devices starts a fresh, empty "account" with nothing carried over.
If that turns out to matter later, Firebase supports upgrading an anonymous
account to email/password in place (`linkWithCredential`) without losing the
existing data — but that's a deliberate follow-up, not part of this build.

## 1. Create the Firebase project

1. [Firebase console](https://console.firebase.google.com/) → **Add project**.
2. **Build → Authentication → Sign-in method** → enable **Anonymous**.
3. **Build → Firestore Database** → Create database → start in **production
   mode**.
4. **Project settings → General → Your apps → Add app → Web (`</>`)**.
   Copy the `firebaseConfig` object into `firebase-config.js`. These values
   are not secret — access is controlled by the security rules below, not by
   hiding the config.

## 2. Firestore security rules

Paste this into **Firestore → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /places/{placeId} {
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerId;
    }

    match /history/{historyId} {
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerId;
    }

    match /routes/{routeId} {
      allow read: if resource.data.public == true;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerId;
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
    }
  }
}
```

Places and history are private to the signed-in user. Routes are readable by
anyone with the link (that's what makes the share button work) but only the
owner can create or delete them.

## 3. Files

```
index.html          — app shell, markup
style.css            — the whole visual identity
app.js               — map, auth, Firestore logic (ES module)
firebase-config.js   — YOUR project keys go here
manifest.json        — PWA metadata
sw.js                — offline app-shell caching
icons/               — add icon-192.png and icon-512.png (any square PNG works)
```

Before deploying, drop a 192×192 and a 512×512 PNG into an `icons/` folder —
`manifest.json` and `index.html` already reference them for the installable
PWA icon.

## 4. Deploy to GitHub Pages

Same as your other apps:

```
git init
git add .
git commit -m "Joogle Maps"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

Then in the repo: **Settings → Pages → Deploy from branch → main → /(root)**.

## Notes / limits carried over from the prototype

- **Nominatim** (search) and **OSRM's public demo router** (directions) are
  free, rate-limited public services — fine for personal use, not for real
  traffic. If this gets real users, swap in a paid geocoding/routing
  provider (or self-host Nominatim/OSRM).
- Map tiles, Nominatim, and OSRM are always fetched live — the service
  worker only caches the app shell (HTML/CSS/JS), not map data, so the app
  still needs a connection to actually show a map.
- History is capped at the last 20 searches per user (trimmed client-side
  on each new search).
