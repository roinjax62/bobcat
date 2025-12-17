# Bobcat Security — Comptabilité (GTA RP)

Site **100% JavaScript (statique)** prévu pour **GitHub Pages**, avec comptes employés + stockage partagé via **Firebase (Auth + Firestore)**.

## Fonctionnalités

- Comptes employés (email / mot de passe)
- Hiérarchie + statut + qualifications
- Saisie **par jour** :
  - nombre de **convois**
  - nombre de **contrôles sécurité**
  - nombre d’**évènements sécurisés**
- Récap hebdomadaire :
  - **Prime max 8 500 000 $** (= convois + sécurité)
  - Salaire convois **max 5 000 000 $**
  - Salaire sécurité **max 3 500 000 $**
  - Salaire évènements **pas de max**
  - Heures = **convois / 2**
  - Rapport **$/heure**
- Bulletin de paie imprimable (Ctrl+P → PDF)
- Contrat CDI auto (modifiable avant impression)
- Admin :
  - création de codes d’invitation
  - modification grade/statut/qualifs/admin

---

## 1) Créer le projet Firebase

1. Va sur la console Firebase
2. Crée un projet
3. **Authentication** → Sign-in method → active **Email/Password**
4. **Firestore Database** → créer une base (mode production conseillé ensuite)

### Authorized domains (important)
Authentication → Settings → **Authorized domains**  
Ajoute :
- `localhost`
- `TONPSEUDO.github.io` (ou le domaine GitHub Pages)
- éventuellement ton domaine custom

Sinon tu auras l’erreur `auth/unauthorized-domain`.

---

## 2) Configurer l'app

Dans `/src/` :

- Copie `config.example.js` en `config.js`
- Colle ton `FIREBASE_CONFIG` (Firebase console → Project settings → Your apps → Web)

---

## 3) Règles Firestore (à copier-coller)

Dans la console Firebase : Firestore → Rules  
Copie le contenu du fichier `firestore.rules` fourni dans ce repo.

⚠️ Ensuite :
- crée TON compte (via l’app, avec un code d’invite)
- puis dans Firestore, passe ton user en admin : `employees/{uid}.isAdmin = true`

---

## 4) Déployer sur GitHub Pages

1. Mets ces fichiers dans un repo GitHub (ex: `bobcat-compta`)
2. GitHub → Settings → Pages
3. Source : `Deploy from a branch`
4. Branch : `main` / folder : `/root`
5. Attends la publication

---

## Notes

- Les rates ($/convoi, etc.) sont modifiables dans l’onglet **Paramètres** (admin).
- Les montants par défaut sont volontairement simples, pour que tu adaptes au RP.

Bon RP 🛡️
