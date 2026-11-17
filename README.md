# MicroPay

**MicroPay** est un pare-feu financier pour agents IA. L’agent (Groq, tool-calling) explore des ressources et peut **demander** un paiement avec une justification ; il ne peut jamais le déclencher lui-même. Un **moteur de politiques** évalue la demande avant qu’elle ne devienne un virement PayPal Sandbox.

Projet construit pour le **PayPal AI Hackathon 2026** — "Build What's Next with PayPal and AI".

## Le principe

L’agent IA **ne peut jamais déclencher un paiement directement**. Il soumet une demande avec une justification et un niveau de confiance. Le moteur de politiques vérifie le budget restant (dépassement = refus), puis évalue les contrôles suivants :

1. Le fournisseur est-il dans la liste autorisée ?
2. Le montant est-il sous le seuil d'auto-approbation ?
3. La fréquence récente de paiements respecte-t-elle la limite fixée ?
4. Le niveau de confiance déclaré par l'agent atteint-il le minimum requis ? (Le texte de justification est journalisé, pas évalué sémantiquement.)

Une règle de politique non satisfaite — fournisseur hors liste, fréquence, confiance ou seuil — place la demande en attente de validation humaine, même si son montant est faible. Une demande qui dépasse le budget restant est refusée. Les demandes conformes sont exécutées via l’**API Payouts de PayPal en Sandbox** ; une demande en attente ne déclenche aucun virement tant qu’elle n’est pas approuvée depuis le dashboard.

L’espace MicroPay regroupe la création et le suivi des missions, le tableau de bord, les demandes d’achat, les validations humaines et les reçus de transaction imprimables ou enregistrables en PDF depuis le navigateur. Les ressources et fournisseurs restent simulés.

### Limites actuelles

- Il n’y a pas de compte ni d’authentification. Le serveur écoute uniquement sur `127.0.0.1` : l’application est destinée à un usage local, pas à un déploiement partagé ou exposé sur Internet.
- Les ressources disponibles sont un catalogue fictif défini dans `backend/src/providers.js`, et non de vrais paywalls ou services.
- Les missions de produits peuvent rechercher des articles fictifs via DummyJSON. Après validation humaine, MicroPay envoie un virement Payouts dans PayPal Sandbox au compte marchand de test configuré. Cela ne crée pas une vraie commande et aucun produit n’est livré.
- Les paiements passent par PayPal Sandbox lorsque les identifiants sont configurés. Ils ne constituent pas des virements en production.
- Les articles DummyJSON exigent `PAYPAL_MODE=sandbox` et `PAYPAL_SANDBOX_RECEIVER_EMAIL`; chaque demande reste en attente jusqu’à votre approbation dans MicroPay.
- La page Factures prépare un reçu imprimable ; la boîte de dialogue du navigateur permet de l’enregistrer en PDF. Il ne s’agit pas d’une facture fiscale.

## Stack

| Couche | Techno |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla |
| Backend | Node.js (Express) |
| Agent IA | Groq (tool-calling), modèle `llama-3.3-70b-versatile` |
| Paiement | PayPal Sandbox — API Payouts |
| Persistance | Fichier JSON (`backend/data/db.json`) |

## Structure du projet

```
micropay/
  backend/
    src/
      server.js          serveur Express et interface web locale
      agent.js            boucle de raisonnement Groq (tool-calling)
      policyEngine.js      moteur de politiques de dépense
      paypal.js            module PayPal (Payouts API sandbox)
      providers.js         fournisseurs et ressources simulés
      store.js             persistance JSON
      routes/missions.js   endpoints API
    .env.example
    package.json
  frontend/
    index.html          page d'accueil animée
    workspace.html      espace de contrôle, missions, achats et reçus
    css/theme.css         thème sombre et typographies Syne / DM Sans
    css/home.css          styles de la page d'accueil
    css/workspace.css     styles de l'espace de contrôle
    js/api.js             appels vers le backend
    js/workspace.js       tableau de bord, achats et reçus
    js/theme.js           bascule de thème
    js/theme-init.js      application du thème mémorisé
  README.md
```

## Installation

### Lancer MicroPay

```bash
cd micropay/backend
npm install
```

Créer `backend/.env` et renseigner les identifiants nécessaires :

```
GROQ_API_KEY=ta_clé_groq
PAYPAL_CLIENT_ID=ton_client_id_sandbox
PAYPAL_CLIENT_SECRET=ton_client_secret_sandbox
PAYPAL_MODE=sandbox
PAYPAL_SANDBOX_RECEIVER_EMAIL=adresse_du_compte_marchand_sandbox
```

- Clé Groq gratuite : https://console.groq.com
- App PayPal sandbox (client id/secret) : https://developer.paypal.com/dashboard/applications
- Utilisez l’adresse d’un compte marchand **Sandbox** comme destinataire; ne mettez jamais de secret dans le frontend ou dans le chat.

Lancer le backend, qui sert aussi le frontend :

```bash
npm start
```

Ouvrir `http://localhost:4000`. La route API de santé est disponible sur `http://localhost:4000/api/health`. Le serveur est lié à `127.0.0.1` et n’est pas destiné à un usage public sans authentification.

## Utilisation

1. Depuis l’accueil, cliquer sur **Commencer** pour ouvrir l’espace MicroPay, sans inscription ni connexion.
2. Créer une mission et définir son budget ainsi que ses règles de dépense. L’espace de mission affiche la demande, les étapes utiles de l’agent et sa réponse finale sous forme de conversation.
3. Suivre les demandes dans **Achats** et approuver ou refuser manuellement celles qui sont escaladées.
4. Consulter les transactions terminées dans **Factures** ; imprimer un reçu ou l’enregistrer en PDF depuis le navigateur.

## Fournisseurs simulés

Pour fiabiliser la démonstration, MicroPay n'interroge pas de vrais paywalls : `backend/src/providers.js` définit 5 ressources fictives réparties sur 4 fournisseurs, avec des profils de risque variés pour que le moteur de politiques puisse prendre différentes décisions.

## Pourquoi l'API Payouts plutôt que Checkout

Un paiement déclenché par un agent autonome est un envoi d'argent **sortant**, sans acheteur humain disponible pour approuver une transaction de façon interactive. L'API Payouts de PayPal est faite pour ça : un virement direct vers l'email du destinataire, déclenché côté serveur. C'est le choix technique cohérent avec le concept d'agentic commerce.

## Catégories visées (PayPal AI Hackathon)

- Best Overall
- Best Use of Agentic Commerce
- Best Use of PayPal + AI

## Licence

MIT
