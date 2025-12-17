// Renomme ce fichier en `config.js` et remplis avec TON projet Firebase.
// Astuce : dans Firebase Console -> Project settings -> "Your apps" -> Web app config

export const FIREBASE_CONFIG = {
  apiKey: "XXXX",
  authDomain: "XXXX.firebaseapp.com",
  projectId: "XXXX",
  storageBucket: "XXXX.appspot.com",
  messagingSenderId: "XXXX",
  appId: "XXXX"
};

// Emails qui doivent voir le bouton "Admin" (UI seulement).
// IMPORTANT : l'accès réel est contrôlé par Firestore Rules, pas par cette liste.
export const UI_ADMIN_EMAILS = [
  "ton.email@example.com"
];

// Valeurs par défaut si aucun doc Firestore `settings/pay` n'existe encore.
export const DEFAULT_PAY_SETTINGS = {
  convoyRate: 250000,       // $ par convoi
  securityRate: 175000,     // $ par contrôle sécurité
  eventRate: 250000,        // $ par événement sécurisé (pas de max)
  convoyMax: 5000000,       // plafond hebdo convois
  securityMax: 3500000,     // plafond hebdo sécurité
  primeMax: 8500000,        // plafond prime (= convois + sécurité)
  // barème salaires de base (hebdo)
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
