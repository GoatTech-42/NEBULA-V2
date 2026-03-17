// ═══════════════════════════════
//  firebase.js — init & auth
// ═══════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, onSnapshot, orderBy, limit, serverTimestamp, increment, deleteDoc, addDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkjYpi0MY0JVtSKAmJ-K2Kr93k2F6gqmg",
  authDomain: "nebulav2.firebaseapp.com",
  projectId: "nebulav2",
  storageBucket: "nebulav2.firebasestorage.app",
  messagingSenderId: "742942256780",
  appId: "1:742942256780:web:6a231d1480045cedaa95a9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Export everything needed across modules
export { app, db, auth,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs,
  onSnapshot, orderBy, limit, serverTimestamp, increment, deleteDoc,
  addDoc, writeBatch,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
};