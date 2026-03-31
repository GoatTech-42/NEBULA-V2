// firebase.js — Firebase initialization, App Check, and auth exports
//
// All Firebase SDKs load from the CDN at a pinned version.
// Everything the rest of the app needs from Firebase is re-exported here
// so other modules only need to import from './firebase.js'.
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
  initializeAppCheck, ReCaptchaV3Provider
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

// App Check using reCAPTCHA v3.
// Firebase enforces this on Auth, Firestore, and RTDB for the project.
// Wrapped in try/catch so a transient failure doesn't break the auth screen.
let appCheck = null;
try {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6Lc4cp0sAAAAAGkoNd1ahosgB_OpaWp6AQFZYsU1'),
    isTokenAutoRefreshEnabled: true
  });
} catch (e) {
  console.warn('[Nebula] App Check initialization failed:', e.message,
    '- Auth may not work until this is resolved.');
}

const db   = getFirestore(app);
const auth = getAuth(app);

export {
  app, appCheck, db, auth,
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs,
  onSnapshot, orderBy, limit, serverTimestamp,
  increment, deleteDoc, addDoc, writeBatch,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
};
