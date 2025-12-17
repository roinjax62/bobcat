// Renomme ce fichier en `config.js` et remplis avec TON projet Firebase.
// Astuce : dans Firebase Console -> Project settings -> "Your apps" -> Web app config

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDnoRfpzMtvqCmIq2A3q2oxKce9bJ_gRvg",
  authDomain: "bobcat-86023.firebaseapp.com",
  projectId: "bobcat-86023",
  storageBucket: "bobcat-86023.firebasestorage.app",
  messagingSenderId: "141938453342",
  appId: "1:141938453342:web:07565cc53924382d1e7dcf",
  measurementId: "G-415GF4H1FW"
};

// Emails qui doivent voir le bouton "Admin" (UI seulement).
// IMPORTANT : l'accès réel est contrôlé par Firestore Rules, pas par cette liste.
export const UI_ADMIN_EMAILS = [
  "tomd62fr@gmail.com"
];

// Valeurs par défaut si aucun doc Firestore `settings/pay` n'existe encore.
export const DEFAULT_PAY_SETTINGS = {
  directorWeekly: 8500000, // Directeur + Co-directeur : fixe hebdo
  convoyRate: 250000,       // $ par convoi
  securityRate: 175000,     // $ par contrôle sécurité
  eventRate: 250000,        // $ par événement sécurisé (pas de max)
  convoyMax: 5000000,       // plafond hebdo convois
  securityMax: 3500000,     // plafond hebdo sécurité
  primeMax: 8500000,        // plafond prime (= convois + sécurité)
  // barème $/heure (convois) selon grade
  baseSalaries: {
    "Directeur": 0,
    "Co-directeur": 0,
    "Assistant Directeur": 700000,
    "Responsable": 600000,
    "Superviseur": 550000,
    "Officier III": 400000,
    "Officier II": 375000,
    "Officier I": 350000,
    "Opérateur III": 325000,
    "Opérateur II": 300000,
    "Opérateur I": 275000,
    "Novice": 250000
  }
};
