// ═══════════════════════════════════════════════════════════════
//  firebase.config.js
//  Shared Firebase configuration for all pages
//  Procurement Department DTR System — University of Baguio
// ═══════════════════════════════════════════════════════════════
//
//  ⚠️  Replace the values below with your own Firebase project config.
//  You can find these in: Firebase Console → Project Settings → Your Apps
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyBZ_k55MzGD3j10Qrw3JTHqiF5sT4kAEmg",
  authDomain:        "procurement-dtr.firebaseapp.com",
  projectId:         "procurement-dtr",
  storageBucket:     "procurement-dtr.firebasestorage.app",
  messagingSenderId: "159133171461",
  appId:             "1:159133171461:web:2144d74d0f9feb9c5a016c",
  measurementId:     "G-TQBV6LRBZZ"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();


// ═══════════════════════════════════════════════════════════════
//  Firestore Security Rules
//  Add this rule in Firebase Console → Firestore → Rules:
//  allow read, write: if request.auth != null;
// ═══════════════════════════════════════════════════════════════