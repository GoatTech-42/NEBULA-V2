// ═══════════════════════════════
//  firebase.js — init & auth
// ═══════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, onSnapshot, orderBy, limit, serverTimestamp, increment, deleteDoc, addDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "oh nah",
  authDomain: "nebulav2.firebaseapp.com",
  projectId: "nebulav2",
  storageBucket: "nebulav2.firebasestorage.app",
  messagingSenderId: "742942256780",
  appId: "1:742942256780:web:6a231d1480045cedaa95a9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Initialize Firebase App Check with reCAPTCHA v3
// Use the SITE KEY (public key) only, never the secret key in frontend code
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6Ld-N48sAAAAAOn5Qm_EgZ8ZtB8SXff0hWZjB-kI'),
  isTokenAutoRefreshEnabled: true
});

// Export everything needed across modules
export { app, db, auth,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs,
  onSnapshot, orderBy, limit, serverTimestamp, increment, deleteDoc,
  addDoc, writeBatch,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
};
