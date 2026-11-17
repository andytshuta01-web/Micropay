// Agent IA — raisonne via Groq (tool-calling). Il ne peut qu'émettre des
// demandes structurées (consulter_ressource, rechercher_produits, demander_paiement) : il ne touche
// jamais directement au module PayPal. C'est l'orchestrateur qui intercepte
// chaque appel d'outil et le fait passer par le moteur de politiques.

import Groq from 'groq-sdk';
import { config } from './config.js';
import { listResources, searchDemoProducts } from './providers.js';

const groq = new Groq({ apiKey: config.groq.apiKey });

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lister_ressources',
      description:
        "Retourne les ressources prédéfinies disponibles avec leur prix et leur fournisseur.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rechercher_produits',
      description:
        "Recherche des produits dans le catalogue de démonstration DummyJSON. Les produits et commandes sont fictifs; aucune livraison ni aucun paiement réel n'est possible.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Mots-clés courts décrivant le produit recherché; utilise l’anglais si nécessaire.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'demander_paiement',
      description:
        "Demande le paiement d'une ressource jugée pertinente pour la mission. Cette demande est examinée par un moteur de politiques avant toute exécution réelle — elle peut être autorisée automatiquement, mise en attente de validation humaine, ou refusée.",
      parameters: {
        type: 'object',
        properties: {
          resource_id: { type: 'string', description: "L'identifiant de la ressource à payer." },
          raison: {
            type: 'string',
            description: 'Justification précise : pourquoi cette ressource sert la mission.',
          },
          confiance: {
            type: 'number',
            description: 'Niveau de confiance de 0 à 1 dans la pertinence de cette dépense.',
          },
        },
        required: ['resource_id', 'raison', 'confiance'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ignorer_ressource',
      description: "Signale qu'une ressource a été examinée mais écartée, sans paiement.",
      parameters: {
        type: 'object',
        properties: {
          resource_id: { type: 'string' },
          raison: { type: 'string' },
        },
        required: ['resource_id', 'raison'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminer_mission',
      description: 'Signale que la mission est terminée (budget épuisé ou objectif atteint).',
      parameters: {
        type: 'object',
        properties: { resume: { type: 'string' } },
        required: ['resume'],
      },
    },
  },
];

function systemPrompt(mission, policy, budgetRemaining) {
  return `Tu es un agent IA autonome chargé d'accomplir une mission pour un utilisateur humain.

MISSION : ${mission.objective}

RÈGLES IMPORTANTES :
- Tu disposes d'un budget total de ${mission.budgetTotal.toFixed(2)} USD, dont il reste ${budgetRemaining.toFixed(2)} USD.
- Pour chaque ressource payante, évalue d'abord sa pertinence réelle par rapport à la mission — ne paie jamais une ressource non pertinente, même si elle est peu chère.
- Chaque demande de paiement doit être accompagnée d'une raison précise et d'un niveau de confiance honnête (0 à 1). Un paiement non justifié sera automatiquement rejeté.
- Tu ne décides pas toi-même si le paiement est exécuté : un système de contrôle séparé applique des règles de sécurité. Fais simplement les meilleures demandes possibles.
- Pour une demande de produit qui ne figure pas dans les ressources prédéfinies, cherche-le avec "rechercher_produits". N'invente jamais de produit ni de prix; si aucun résultat ne correspond, explique-le.
- Présente toujours les produits sous une forme générique. Ne répète ni marque ni nom de modèle commercial, même si l'utilisateur ou une source les mentionne.
- Toute demande issue de DummyJSON doit être présentée comme une simulation et nécessite une validation humaine. Elle ne déclenche ni paiement PayPal ni livraison réelle.
- Explore les ressources pertinentes, demande une validation uniquement pour les achats liés à la mission, puis termine la mission avec un résumé honnête.
- Termine par une réponse courte adressée à l’utilisateur : résume le résultat et l’état des demandes sans exposer de raisonnement interne détaillé.`;
}

/**
 * Exécute la boucle de l'agent. onToolCall(name, args) doit retourner le
 * résultat à renvoyer au modèle (déjà passé par l'orchestrateur + le moteur
 * de politiques pour demander_paiement).
 */
export async function runAgentLoop({ mission, policy, getBudgetRemaining, onToolCall, onLog }) {
  const messages = [
    { role: 'system', content: systemPrompt(mission, policy, getBudgetRemaining()) },
    { role: 'user', content: 'Commence la mission.' },
  ];

  const MAX_TURNS = 8;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const completion = await groq.chat.completions.create({
      model: config.groq.model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
    });

    const choice = completion.choices[0];
    const msg = choice.message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      onLog?.({ etape: 'raisonnement_final', raisonnement_agent: msg.content || '' });
      break;
    }

    let missionEnded = false;

    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }

      if (name === 'lister_ressources') {
        const result = listResources();
        onLog?.({ etape: 'exploration', raisonnement_agent: `L'agent consulte les ${result.length} ressources disponibles.` });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        continue;
      }

      if (name === 'rechercher_produits') {
        const result = await searchDemoProducts(args.query);
        onLog?.({
          etape: 'recherche_produits',
          raisonnement_agent: `L'agent consulte le catalogue de démonstration et trouve ${result.length} produit(s) générique(s).`,
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        continue;
      }

      if (name === 'demander_paiement') {
        onLog?.({
          etape: 'demande_paiement',
          raisonnement_agent: `Ressource ${args.resource_id} — raison : ${args.raison} (confiance ${args.confiance}).`,
        });
        const result = await onToolCall('demander_paiement', args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        continue;
      }

      if (name === 'ignorer_ressource') {
        onLog?.({
          etape: 'ressource_ignoree',
          raisonnement_agent: `Ressource ${args.resource_id} écartée — ${args.raison}`,
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
        continue;
      }

      if (name === 'terminer_mission') {
        onLog?.({ etape: 'mission_terminee', raisonnement_agent: args.resume || 'Mission terminée.' });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
        missionEnded = true;
        continue;
      }

      // Outil inconnu — on ferme proprement la boucle plutôt que de planter.
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'outil inconnu' }) });
    }

    if (missionEnded) break;
  }
}
