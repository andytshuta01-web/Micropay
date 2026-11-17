// Moteur de politiques — le composant central de MicroPay.
// L'agent IA ne peut JAMAIS déclencher un paiement directement : toute demande
// passe ici d'abord. Une seule règle violée suffit à escalader, même sous le
// seuil de montant. C'est ce qui transforme "un agent qui paie" en "un agent
// gouverné".

/**
 * @param {object} policy - PolitiqueDeDepense de la mission
 * @param {object} params
 * @param {string} params.providerId
 * @param {number} params.amount
 * @param {number} params.confidence - 0 à 1, fourni par l'agent dans sa justification
 * @param {number} params.budgetRemaining
 * @param {Array<{ts:number}>} params.recentPayments - paiements exécutés dans la mission
 * @returns {{verdict: 'AUTORISER'|'ESCALADER'|'REFUSER', rule: string, detail: string}}
 */
export function evaluatePolicy(policy, { providerId, amount, confidence, budgetRemaining, recentPayments }) {
  // 1. Budget — refus ferme, jamais d'escalade possible au-delà du budget total
  if (amount > budgetRemaining) {
    return {
      verdict: 'REFUSER',
      rule: 'budget_insuffisant',
      detail: `Montant ${amount.toFixed(2)} USD supérieur au budget restant (${budgetRemaining.toFixed(2)} USD).`,
    };
  }

  // 2. Fournisseur hors liste autorisée
  if (policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(providerId)) {
    return {
      verdict: 'ESCALADER',
      rule: 'fournisseur_non_autorise',
      detail: `Le fournisseur n'est pas dans la liste des fournisseurs de confiance de la mission.`,
    };
  }

  // 3. Fréquence — évite qu'une boucle d'erreur de l'agent vide le budget
  const now = Date.now();
  const recentCount = (recentPayments || []).filter((p) => now - p.ts < 60_000).length;
  if (recentCount >= policy.maxPaymentsPerMinute) {
    return {
      verdict: 'ESCALADER',
      rule: 'frequence_excessive',
      detail: `${recentCount} paiement(s) déjà exécuté(s) dans la dernière minute (limite : ${policy.maxPaymentsPerMinute}).`,
    };
  }

  // 4. Qualité de la justification fournie par l'agent
  if (typeof confidence !== 'number' || confidence < policy.minConfidence) {
    return {
      verdict: 'ESCALADER',
      rule: 'justification_insuffisante',
      detail: `Confiance déclarée par l'agent (${confidence ?? 'absente'}) sous le minimum requis (${policy.minConfidence}).`,
    };
  }

  // 5. Seuil d'auto-approbation
  if (amount > policy.autoApproveThreshold) {
    return {
      verdict: 'ESCALADER',
      rule: 'seuil_depasse',
      detail: `Montant ${amount.toFixed(2)} USD supérieur au seuil d'auto-approbation (${policy.autoApproveThreshold.toFixed(2)} USD).`,
    };
  }

  return {
    verdict: 'AUTORISER',
    rule: 'toutes_regles_respectees',
    detail: 'Montant sous le seuil, fournisseur autorisé, fréquence et justification conformes.',
  };
}
