// ═══════════════════════════════
//  firebase.js — init & auth
//  FIX: Added App Check with reCAPTCHA Enterprise (required by Firebase Console config)
//  FIX: Added missing databaseURL (RTDB was completely broken without it)
// ═══════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs, onSnapshot,
  orderBy, limit, serverTimestamp, increment,
  deleteDoc, addDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCyIjduPo3L7z0XnoKEamjInTkQWQnGpqI",
  authDomain:        "nebulahistorians.firebaseapp.com",
  databaseURL:       "https://nebulahistorians-default-rtdb.firebaseio.com",
  projectId:         "nebulahistorians",
  storageBucket:     "nebulahistorians.firebasestorage.app",
  messagingSenderId: "839196477534",
  appId:             "1:839196477534:web:0ece64201defb6dc178ccf"
};

const app  = initializeApp(firebaseConfig);

// ── App Check ──────────────────────────────────────────────────────────────
// App Check is enforced in the Firebase Console for this project.
// Replace the site key below with your reCAPTCHA Enterprise site key from:
//   Firebase Console → App Check → Apps → your web app → reCAPTCHA Enterprise
// If you want to test locally without a real token, set this before the page loads:
//   self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
// (or a specific debug token string from the Firebase Console)
try {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      // ← PASTE YOUR reCAPTCHA ENTERPRISE SITE KEY HERE
      "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY"
    ),
    isTokenAutoRefreshEnabled: true,
  });
} catch (e) {
  console.warn("[App Check] Failed to initialise:", e.message);
}

const db   = getFirestore(app);
const auth = getAuth(app);

export {
  app, db, auth,
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs,
  onSnapshot, orderBy, limit, serverTimestamp,
  increment, deleteDoc, addDoc, writeBatch,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
};
