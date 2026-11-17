// Fournisseurs simulés — remplacent de vrais paywalls/API pour fiabiliser la démo.
// Chaque fournisseur a un profil de risque différent (connu / nouveau / cher)
// pour que le moteur de politiques ait de vraies décisions à prendre.

export const PROVIDERS = [
  {
    id: 'prov_cryptoweekly',
    name: 'CryptoWeekly',
    trusted: true,
    sandboxReceiverEmail: 'sb-provider1@business.example.com',
  },
  {
    id: 'prov_onchain',
    name: 'OnChain Analytics',
    trusted: true,
    sandboxReceiverEmail: 'sb-provider2@business.example.com',
  },
  {
    id: 'prov_marketpulse',
    name: 'MarketPulse API',
    trusted: true,
    sandboxReceiverEmail: 'sb-provider3@business.example.com',
  },
  {
    id: 'prov_unknownblog',
    name: 'RandomTake Blog',
    trusted: false, // hors allowlist par défaut : force une escalade pour la démo
    sandboxReceiverEmail: 'sb-provider4@business.example.com',
  },
  {
    id: 'prov_dummyjson',
    name: 'Boutique générique de démonstration',
    trusted: false,
    demoOnly: true,
  },
];

export const DEMO_PROVIDER_ID = 'prov_dummyjson';

export const RESOURCES = [
  {
    id: 'res_1',
    providerId: 'prov_cryptoweekly',
    title: 'CryptoWeekly Deep Dive — Semaine du 3 nov.',
    category: 'analyse_marche',
    price: 0.4,
    summary:
      'Analyse hebdomadaire des mouvements de prix majeurs sur BTC, ETH et les principales altcoins.',
  },
  {
    id: 'res_2',
    providerId: 'prov_onchain',
    title: 'Institutional Flows Q4 — Rapport complet',
    category: 'analyse_marche',
    price: 1.2,
    summary:
      "Étude détaillée des flux de capitaux institutionnels sur les marchés crypto au 4e trimestre.",
  },
  {
    id: 'res_3',
    providerId: 'prov_marketpulse',
    title: 'MarketPulse API — accès données temps réel',
    category: 'donnees',
    price: 1.5,
    summary: "Accès à un flux de données de marché en temps réel, utile pour une analyse chiffrée.",
  },
  {
    id: 'res_4',
    providerId: 'prov_unknownblog',
    title: 'Market Noise — Daily Recap',
    category: 'analyse_marche',
    price: 0.15,
    summary: 'Résumé quotidien générique, faible profondeur éditoriale.',
  },
  {
    id: 'res_5',
    providerId: 'prov_cryptoweekly',
    title: 'CryptoWeekly — Rapport régulation US',
    category: 'reglementation',
    price: 0.9,
    summary: "Point sur les évolutions réglementaires américaines impactant les cryptoactifs.",
  },
];

const demoResources = new Map();
const MAX_DEMO_RESULTS = 6;
const MAX_CACHED_DEMO_RESOURCES = 200;
const MAX_DEMO_PRODUCT_PRICE = 100_000;
const DEMO_CATEGORY_LABELS = {
  smartphones: 'téléphone',
  'mobile-accessories': 'accessoire mobile',
  laptops: 'ordinateur',
  tablets: 'tablette',
  'mens-shirts': 'vêtement',
  'womens-dresses': 'vêtement',
  'womens-shoes': 'chaussure',
  'mens-shoes': 'chaussure',
  'mens-watches': 'accessoire',
  'womens-watches': 'accessoire',
  'home-decoration': 'décoration',
  furniture: 'meuble',
  'kitchen-accessories': 'accessoire de cuisine',
  groceries: 'produit alimentaire',
  beauty: 'produit de soin',
  fragrances: 'produit de soin',
  'skin-care': 'produit de soin',
  'sports-accessories': 'accessoire de sport',
  sunglasses: 'accessoire',
  automotive: 'accessoire automobile',
  motorcycle: 'accessoire moto',
  lighting: 'éclairage',
};

export function listResources() {
  return RESOURCES.map((r) => ({
    ...r,
    provider: PROVIDERS.find((p) => p.id === r.providerId)?.name,
  }));
}

export function listProviders() {
  return PROVIDERS.map(({ id, name }) => ({ id, name }));
}

export async function searchDemoProducts(query) {
  const searchQuery = typeof query === 'string' ? query.trim().slice(0, 100) : '';
  if (!searchQuery) throw new Error('Un terme de recherche est requis.');

  const url = new URL('https://dummyjson.com/products/search');
  url.searchParams.set('q', searchQuery);
  url.searchParams.set('limit', String(MAX_DEMO_RESULTS));

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`Le catalogue DummyJSON a répondu avec le statut ${response.status}.`);
  }

  const data = await response.json();
  if (!Array.isArray(data.products)) {
    throw new Error('Réponse invalide du catalogue DummyJSON.');
  }

  return data.products.slice(0, MAX_DEMO_RESULTS).flatMap((product) => {
    if (!product || typeof product !== 'object') return [];

    const externalProductId = product.id;
    const rawPrice = product.price;
    if (!Number.isSafeInteger(externalProductId) || externalProductId <= 0 ||
      typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) ||
      rawPrice < 0 || rawPrice > MAX_DEMO_PRODUCT_PRICE) {
      return [];
    }

    const categoryKey = typeof product.category === 'string' ? product.category : '';
    const resource = {
      id: `dummyjson-${externalProductId}`,
      externalProductId,
      providerId: DEMO_PROVIDER_ID,
      provider: PROVIDERS.find((provider) => provider.id === DEMO_PROVIDER_ID).name,
      title: `Article de démonstration #${externalProductId}`,
      category: Object.hasOwn(DEMO_CATEGORY_LABELS, categoryKey)
        ? DEMO_CATEGORY_LABELS[categoryKey]
        : 'article',
      price: Math.round(rawPrice * 100) / 100,
      currency: 'USD',
      summary: 'Article fictif du catalogue. Aucune commande réelle ni livraison.',
      isDemoProduct: true,
    };

    demoResources.set(resource.id, resource);
    while (demoResources.size > MAX_CACHED_DEMO_RESOURCES) {
      demoResources.delete(demoResources.keys().next().value);
    }
    return [resource];
  });
}

export function getResource(id) {
  return RESOURCES.find((r) => r.id === id) || demoResources.get(id);
}

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}
