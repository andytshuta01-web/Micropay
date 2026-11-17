import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getResource, searchDemoProducts } from '../src/providers.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('searchDemoProducts maps and caches valid DummyJSON products', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://dummyjson.com');
    assert.equal(url.pathname, '/products/search');
    assert.equal(url.searchParams.get('q'), 'wireless headphones');
    assert.equal(url.searchParams.get('limit'), '6');
    return Response.json({
      products: [{
        id: 9876,
        title: 'Wireless Headphones',
        description: 'Demo headset',
        category: 'mobile-accessories',
        price: 39.99,
      }],
    });
  };

  const [resource] = await searchDemoProducts('wireless headphones');

  assert.equal(resource.id, 'dummyjson-9876');
  assert.equal(resource.providerId, 'prov_dummyjson');
  assert.equal(resource.title, 'Article de démonstration #9876');
  assert.equal(resource.category, 'accessoire mobile');
  assert.equal(resource.price, 39.99);
  assert.equal(resource.isDemoProduct, true);
  assert.equal(getResource(resource.id), resource);
});

test('searchDemoProducts rejects an empty query without calling the API', async () => {
  globalThis.fetch = () => {
    assert.fail('fetch should not be called for an empty query');
  };

  await assert.rejects(searchDemoProducts('  '), /terme de recherche est requis/);
});

test('searchDemoProducts reports catalog HTTP errors', async () => {
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });

  await assert.rejects(searchDemoProducts('earbuds'), /statut 503/);
});
