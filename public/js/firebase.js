// ═══════════════════════════════
//  firebase.js — init & auth
//  FIX: Removed App Check (reCAPTCHA 500 errors blocking all auth)
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