"use client";

import React, { useState, useMemo } from "react";

// ============================================================
// PSYCHOSIS DIFFERENTIAL — Bayesian-style symptom scoring
// ============================================================
// Design notes:
// - Weights are ORDINAL (semi-quantitative), not real LRs.
//   The literature has hard numbers for some features
//   (e.g. visual hallucinations 3x more likely in secondary
//   psychosis; ~62% grandiose delusions in mania) but most
//   phenomenology lacks published LRs. Weights reflect those
//   numbers where available and the document's framing
//   elsewhere. Surfaced honestly in the UI.
// - Red-flag layer is parallel to scoring: emergencies don't
//   wait for the scoreboard to update.
// - Base rates set per first-episode/general psychiatric prior.
// ============================================================

// Weight scale (log-odds-like, ordinal):
//   +3 strong positive   +2 moderate positive   +1 weak positive
//   -1 weak negative     -2 moderate negative   -3 strong negative
// "rules_in" forces inclusion regardless of score.
// "rules_out" forces exclusion when feature absent is required.

const DIAGNOSES = [
  { id: "scz", label: "Schizophrenia-spectrum", base: 0, category: "primary" },
  { id: "atpd", label: "Acute & transient psychotic disorder", base: -1, category: "primary" },
  { id: "delusional", label: "Delusional disorder", base: -2, category: "primary" },
  { id: "mania", label: "Bipolar I — manic psychosis", base: 0, category: "affective" },
  { id: "psymdd", label: "Psychotic depression (PsyMDD)", base: -1, category: "affective" },
  { id: "mixed", label: "Mixed affective state w/ psychosis", base: -2, category: "affective" },
  { id: "ppp", label: "Postpartum psychosis", base: -4, category: "affective" },
  { id: "stim", label: "Stimulant-induced psychosis (meth/cocaine)", base: -1, category: "substance" },
  { id: "alcohol", label: "Alcohol-induced psychotic disorder", base: -2, category: "substance" },
  { id: "cycloid", label: "Cycloid psychosis (WKL)", base: -3, category: "primary" },
  { id: "delirium", label: "Delirium / metabolic / toxic encephalopathy", base: -1, category: "secondary" },
  { id: "antinmda", label: "Anti-NMDA receptor encephalitis", base: -4, category: "secondary" },
  { id: "sle", label: "Neuropsychiatric SLE", base: -4, category: "secondary" },
  { id: "endocrine", label: "Endocrine (thyroid / Cushing)", base: -3, category: "secondary" },
  { id: "dlb", label: "Dementia with Lewy bodies", base: -3, category: "neurodegen" },
  { id: "bvftd", label: "Behavioral-variant FTD", base: -3, category: "neurodegen" },
];

type DxId = (typeof DIAGNOSES)[number]["id"];

// Feature catalog. Each feature carries weights per diagnosis.
// Grouped for UI organization.
const FEATURES = [
  // ---------- DEMOGRAPHICS ----------
  {
    group: "Demographics & history",
    items: [
      // Age bands — mutually exclusive in practice but tool doesn't enforce
      {
        id: "age_under18",
        label: "Age < 18",
        weights: { scz: -1, atpd: 1, mania: -1, dlb: -3, bvftd: -3, delusional: -3, sle: -1 },
      },
      {
        id: "age_18_30",
        label: "Age 18–30 (peak primary psychosis window)",
        weights: { scz: 2, mania: 2, atpd: 1, stim: 1, antinmda: 1, dlb: -3, bvftd: -3, delusional: -2 },
      },
      {
        id: "age_30_45",
        label: "Age 30–45",
        weights: { scz: 0, mania: 0, psymdd: 1, delusional: 1, dlb: -2, bvftd: -1 },
      },
      {
        id: "age_45_60",
        label: "Age 45–60",
        weights: { scz: -1, mania: -1, psymdd: 1, delusional: 2, bvftd: 1, dlb: 0 },
      },
      {
        id: "age_over60",
        label: "Age > 60 (late-life onset)",
        weights: { dlb: 3, bvftd: 2, endocrine: 1, sle: 1, delirium: 1, scz: -3, atpd: -1, mania: -2 },
      },
      // Sex — modest weights, biology not bias
      {
        id: "sex_female",
        label: "Female",
        weights: { sle: 2, antinmda: 1, psymdd: 1, ppp: 1, scz: -1 },
      },
      {
        id: "sex_male",
        label: "Male",
        weights: { scz: 1, stim: 1, alcohol: 1, bvftd: 1, sle: -2, ppp: -5 },
      },
      // Reproductive context
      {
        id: "currently_pregnant",
        label: "Currently pregnant",
        weights: { sle: 1, mania: 0, psymdd: 0 },
      },
      {
        id: "within_year_postpartum",
        label: "Within 1 year postpartum (broader window)",
        weights: { ppp: 2, mania: 1, psymdd: 1, sle: 1 },
      },
      // Family history
      {
        id: "fhx_scz",
        label: "Family history of schizophrenia",
        weights: { scz: 2, atpd: 1, cycloid: 1 },
      },
      {
        id: "fhx_bipolar",
        label: "Family history of bipolar disorder",
        weights: { mania: 2, mixed: 2, psymdd: 1, ppp: 1 },
      },
      {
        id: "fhx_neurodegen",
        label: "Family history of dementia / FTD",
        weights: { dlb: 1, bvftd: 2 },
      },
      {
        id: "fhx_autoimmune",
        label: "Family history of autoimmune disease",
        weights: { sle: 2, antinmda: 1, endocrine: 1 },
      },
      // Personal psych history
      {
        id: "prior_psychosis",
        label: "Prior psychotic episode(s)",
        weights: { scz: 2, mania: 1, psymdd: 1, delusional: 1, atpd: -1, antinmda: -1 },
      },
      {
        id: "first_episode",
        label: "First lifetime episode",
        weights: { atpd: 1, antinmda: 1, sle: 1, stim: 1, delusional: -1 },
      },
      {
        id: "visual_impairment",
        label: "Significant visual impairment (cataract, macular degen, etc.)",
        weights: { dlb: 1 },
      },
    ],
  },
  // ---------- SENSORIUM / COURSE ----------
  {
    group: "Sensorium & cognition",
    items: [
      {
        id: "fluctuating_attention",
        label: "Fluctuating attention / clouded sensorium",
        weights: { delirium: 3, antinmda: 3, sle: 2, dlb: 2, endocrine: 2, scz: -2, mania: -1, psymdd: -1, alcohol: -2 },
        redFlag: "delirium_workup",
      },
      {
        id: "clear_sensorium",
        label: "Clear sensorium throughout",
        weights: { scz: 1, mania: 1, psymdd: 1, alcohol: 2, delirium: -3, antinmda: -2 },
      },
      {
        id: "cognitive_decline",
        label: "Progressive cognitive / personality decline",
        weights: { dlb: 3, bvftd: 3, scz: -1, atpd: -2, cycloid: -2 },
      },
      {
        id: "perplexity",
        label: "Perplexity / disorientation w/ motor disturbance",
        weights: { mixed: 3, ppp: 3, cycloid: 2, atpd: 2, scz: -1 },
      },
      {
        id: "intact_insight",
        label: "Intact insight (recognizes hallucinations as not real)",
        weights: { scz: -2, mania: -1, psymdd: -1, delusional: -2, atpd: -1 },
      },
    ],
  },
  // ---------- TEMPO ----------
  {
    group: "Onset & tempo",
    items: [
      {
        id: "hours_days",
        label: "Onset over hours–days",
        weights: { delirium: 3, antinmda: 2, stim: 2, alcohol: 1, scz: -2, delusional: -3, dlb: -2 },
      },
      {
        id: "polymorphic_2wk",
        label: "Polymorphic, rapidly shifting, <2 weeks",
        weights: { atpd: 3, cycloid: 3, mixed: 2, scz: -2, delusional: -3 },
      },
      {
        id: "insidious_prodrome",
        label: "Insidious prodrome over weeks–months",
        weights: { scz: 3, bvftd: 2, dlb: 2, atpd: -3, cycloid: -3, delirium: -2 },
      },
      {
        id: "postpartum_window",
        label: "Onset 1–14 days postpartum",
        weights: { ppp: 5, mixed: 1, scz: -2 },
        rules_in: "ppp",
      },
    ],
  },
  // ---------- MOOD COUPLING ----------
  {
    group: "Mood episode coupling",
    items: [
      {
        id: "mania_active",
        label: "Active manic episode (grandiose, ↓ sleep need, expansive)",
        weights: { mania: 3, mixed: 2, scz: -1, psymdd: -3 },
      },
      {
        id: "depression_active",
        label: "Active major depressive episode",
        weights: { psymdd: 3, mixed: 2, scz: -1, mania: -3 },
      },
      {
        id: "psychosis_only_in_mood",
        label: "Psychosis confined to mood episodes",
        weights: { mania: 2, psymdd: 2, mixed: 2, scz: -3, delusional: -3 },
        rules_out_if_absent: [],
      },
      {
        id: "psychosis_outside_mood",
        label: "Psychosis persists outside mood episodes",
        weights: { scz: 2, delusional: 2, mania: -2, psymdd: -2 },
      },
    ],
  },
  // ---------- HALLUCINATION MODALITY ----------
  {
    group: "Hallucinations",
    items: [
      {
        id: "auditory_3p",
        label: "Third-person auditory voices (commentary / arguing)",
        weights: { scz: 3, mania: 1, psymdd: 1, alcohol: 1, stim: 1, delirium: -1 },
      },
      {
        id: "auditory_mood_congruent",
        label: "Mood-congruent auditory voices",
        weights: { mania: 2, psymdd: 2, scz: -1 },
      },
      {
        id: "auditory_condemning",
        label: "Derogatory / condemnatory voices, clear sensorium",
        weights: { alcohol: 3, psymdd: 2, scz: 1 },
      },
      {
        id: "tactile_formication",
        label: "Tactile hallucinations / formication",
        weights: { stim: 3, alcohol: 1, delirium: 1, scz: -1, mania: -2 },
      },
      {
        id: "visual_inanimate",
        label: "Visual hallucinations (shadows, flashes, inanimate)",
        weights: { delirium: 2, dlb: 3, sle: 2, antinmda: 1, scz: -1 },
        // backed by meta-analysis: 3x more likely in secondary
      },
      {
        id: "visual_complex",
        label: "Complex visual hallucinations (people, animals)",
        weights: { dlb: 3, antinmda: 2, delirium: 2, stim: 1, scz: 0 },
      },
      {
        id: "multimodal",
        label: "Multimodal hallucinations (visual + tactile + auditory)",
        weights: { delirium: 2, antinmda: 2, sle: 2, stim: 1, scz: -2 },
      },
      {
        id: "olfactory_gustatory",
        label: "Olfactory / gustatory hallucinations",
        weights: { delirium: 2, antinmda: 1, sle: 1, scz: -2, mania: -2, psymdd: -1 },
        redFlag: "temporal_workup",
      },
    ],
  },
  // ---------- DELUSIONS ----------
  {
    group: "Delusions",
    items: [
      {
        id: "thought_insertion",
        label: "Thought insertion / withdrawal / broadcasting",
        weights: { scz: 3, mania: 0, psymdd: -1, delirium: -2 },
      },
      {
        id: "delusions_control",
        label: "Delusions of control / passivity",
        weights: { scz: 3, mania: 0, delirium: -1 },
      },
      {
        id: "grandiose",
        label: "Grandiose delusions",
        weights: { mania: 3, scz: 0, psymdd: -3 },
        // ~62% in manic psychosis per literature
      },
      {
        id: "reference",
        label: "Delusions of reference",
        weights: { scz: 1, mania: 2, stim: 1 },
      },
      {
        id: "guilt_punishment",
        label: "Delusions of guilt / deserved punishment / nihilism",
        weights: { psymdd: 3, mania: -3, scz: 0 },
      },
      {
        id: "persecutory",
        label: "Persecutory delusions",
        weights: { stim: 2, alcohol: 2, scz: 1, delusional: 2, sle: 1 },
      },
      {
        id: "capgras",
        label: "Capgras / misidentification delusions",
        weights: { bvftd: 3, dlb: 2, sle: 1, scz: 0 },
      },
      {
        id: "infant_centered",
        label: "Infant-centered delusions (postpartum)",
        weights: { ppp: 3 },
      },
      {
        id: "monothematic_systematized",
        label: "Single, systematized, non-bizarre delusion",
        weights: { delusional: 3, scz: -1 },
      },
    ],
  },
  // ---------- DISORGANIZATION / NEGATIVE ----------
  {
    group: "Disorganization & negative symptoms",
    items: [
      {
        id: "neg_symptoms",
        label: "Negative symptoms (alogia, avolition, flattening)",
        weights: { scz: 3, bvftd: 1, atpd: -1, mania: -2 },
      },
      {
        id: "disorganized_speech",
        label: "Disorganized speech / formal thought disorder",
        weights: { scz: 2, mania: 2, delirium: 1, antinmda: 2 },
      },
      {
        id: "catatonia",
        label: "Catatonic features (mutism, posturing, stupor)",
        weights: { antinmda: 3, ppp: 2, scz: 2, mixed: 2, mania: 1 },
      },
    ],
  },
  // ---------- SUBSTANCE ----------
  {
    group: "Substance & exposure history",
    items: [
      {
        id: "stimulant_use",
        label: "Recent stimulant use (meth / cocaine)",
        weights: { stim: 4, scz: -1 },
      },
      {
        id: "alcohol_heavy",
        label: "Heavy alcohol use / withdrawal context",
        weights: { alcohol: 4, delirium: 2, scz: -1 },
      },
      {
        id: "no_substance",
        label: "Negative substance history & negative tox screen",
        weights: { stim: -3, alcohol: -3, scz: 1, mania: 1 },
      },
      {
        id: "substance_persists",
        label: "Psychosis persists >48h beyond last substance use",
        weights: { stim: 2, alcohol: 2, scz: 1, delirium: -1 },
      },
    ],
  },
  // ---------- NEURO / SYSTEMIC RED FLAGS ----------
  {
    group: "Neurologic & systemic red flags",
    items: [
      {
        id: "fever",
        label: "Fever / signs of infection",
        weights: { antinmda: 3, sle: 2, delirium: 2, scz: -2 },
        redFlag: "infection_workup",
      },
      {
        id: "seizure",
        label: "Seizure activity",
        weights: { antinmda: 3, sle: 2, delirium: 1, scz: -2 },
        redFlag: "neuro_emergency",
      },
      {
        id: "dyskinesia_mutism",
        label: "Orofacial dyskinesia / mutism / speech disintegration",
        weights: { antinmda: 4, scz: -1 },
        redFlag: "antinmda_workup",
      },
      {
        id: "abnormal_vitals",
        label: "Abnormal vitals (tachycardia, hypertension, hyperthermia)",
        weights: { delirium: 2, stim: 2, endocrine: 2, antinmda: 1, scz: -1 },
        redFlag: "medical_workup",
      },
      {
        id: "autoimmune_hx",
        label: "Autoimmune history (SLE, thyroiditis, etc)",
        weights: { sle: 3, antinmda: 1, endocrine: 2 },
      },
      {
        id: "parkinsonism",
        label: "Parkinsonism / extrapyramidal signs",
        weights: { dlb: 3, scz: -1 },
      },
      {
        id: "focal_neuro",
        label: "Focal neurologic deficit / aphasia",
        weights: { sle: 2, antinmda: 2, delirium: 1, scz: -3 },
        redFlag: "neuro_emergency",
      },
    ],
  },
];

const RED_FLAGS = {
  delirium_workup: {
    label: "Delirium workup indicated",
    detail: "Fluctuating sensorium = medical until proven otherwise. CBC, BMP, TFTs, UA, tox screen, ammonia, B12; consider CT head, EEG.",
    severity: "high",
  },
  infection_workup: {
    label: "CNS infection / autoimmune encephalitis on differential",
    detail: "Fever + psychosis warrants LP. Send CSF for cell count, protein, glucose, HSV PCR, and anti-NMDA receptor antibodies (CSF > serum sensitivity).",
    severity: "high",
  },
  neuro_emergency: {
    label: "Neurologic emergency",
    detail: "Seizure or focal deficit changes the workup. Urgent neuroimaging, EEG, neurology consult.",
    severity: "critical",
  },
  antinmda_workup: {
    label: "High suspicion: anti-NMDA receptor encephalitis",
    detail: "Orofacial dyskinesia + mutism + psychosis is the classic tetrad with seizure and autonomic instability. EEG may show extreme delta brush. CSF anti-NMDAR antibodies. Empirical IVIG/steroids may be indicated.",
    severity: "critical",
  },
  medical_workup: {
    label: "Vitals abnormal — broaden medical workup",
    detail: "Consider thyrotoxicosis, sympathomimetic toxicity, NMS/serotonin syndrome, sepsis. ECG, troponin if indicated.",
    severity: "high",
  },
  neurodegen_workup: {
    label: "Late-life first-episode psychosis — neurodegenerative workup indicated",
    detail: "First lifetime psychotic episode after 60 has a high prior for neurodegenerative or medical etiology. Cognitive screening (MoCA), MRI brain, B12/TSH/RPR, consider DAT scan if parkinsonism present. Don't anchor on primary psychiatric diagnosis until neurodegen reasonably excluded.",
    severity: "high",
  },
  temporal_workup: {
    label: "Olfactory/gustatory hallucinations — temporal lobe / structural workup",
    detail: "Olfactory and gustatory hallucinations are atypical for primary psychiatric illness and raise concern for temporal lobe epilepsy, structural lesion, or other neurological process. EEG (with temporal leads), MRI brain with attention to mesial temporal structures, neurology consult.",
    severity: "high",
  },
  charles_bonnet: {
    label: "Consider Charles Bonnet syndrome — do not anchor on psychosis",
    detail: "Visual hallucinations in a patient with significant visual impairment and INTACT insight, without other psychotic features, suggests Charles Bonnet syndrome (release hallucinations from visual deprivation). This is benign and does NOT warrant antipsychotics. Optimize the underlying visual impairment; reassure. Re-evaluate if delusions, disorganization, or loss of insight emerge.",
    severity: "high",
  },
};

// ============================================================
// Weight provenance — which feature weights are anchored to
// published evidence vs. expert judgment. Keyed by feature id.
// Absence from this map = expert-judgment calibration (the
// default for the large majority of weights). This is
// deliberately honest: most feature×diagnosis cells have no
// published likelihood ratio because the discriminating study
// was never done.
// ============================================================
type WeightEvidence = {
  tier: "meta-analysis" | "review" | "case-control";
  summary: string;
  citation: string;
  doi: string;
};

const WEIGHT_EVIDENCE: Record<string, WeightEvidence> = {
  visual_inanimate: {
    tier: "meta-analysis",
    summary:
      "Visual hallucinations associated with secondary psychosis (pooled OR 3.0, 95% CI 1.7–5.1; 14 studies, 904 primary vs 804 secondary). Hallucinations of inanimate objects specifically more likely in secondary psychosis. Prevalence of VH in schizophrenia ~27% (29-study review) — the schizophrenia weight is intentionally only mildly negative because VH do NOT rule out a primary cause.",
    citation:
      "Blackman et al. 2023, Cogn Neuropsychiatry; Waters et al. 2014, Schizophr Bull",
    doi: "10.1080/13546805.2023.2266872",
  },
  visual_complex: {
    tier: "review",
    summary:
      "Complex visual hallucinations are well-documented in schizophrenia (described as remarkably complex and negative in content; weighted-mean VH prevalence 27% in schizophrenia, 15% in affective psychosis). Schizophrenia weight set to neutral rather than negative on this basis.",
    citation: "Waters et al. 2014, Schizophr Bull",
    doi: "10.1093/schbul/sbu036",
  },
  neg_symptoms: {
    tier: "case-control",
    summary:
      "Negative symptoms significantly higher in schizophrenia than prolonged methamphetamine-induced psychosis (p=0.034; n=60). Supports the existing strong positive schizophrenia weight. Small single-site sample — supporting evidence, not a calibration anchor.",
    citation: "Ahmadkhaniha et al. 2022, Basic Clin Neurosci",
    doi: "10.32598/bcn.2021.2837.1",
  },
  thought_insertion: {
    tier: "review",
    summary:
      "First-rank symptoms (incl. thought insertion/withdrawal/broadcast) occur in ~a third of bipolar patients, particularly in mania (systematic review of 339 studies; meta-analysis n=23,461). The strong schizophrenia weight is retained, but the prior negative mania weight was not supported and has been set to neutral — these symptoms point toward schizophrenia without arguing against mania.",
    citation:
      "Chakrabarti & Singh 2022, World J Psychiatry; Aminoff et al. 2022, Psychol Med",
    doi: "10.5498/wjp.v12.i9.1204",
  },
  delusions_control: {
    tier: "review",
    summary:
      "Passivity/control phenomena are reported in ~23-24% of patients during manic episodes (339-study systematic review). Schizophrenia weight retained; prior negative mania weight set to neutral as unsupported.",
    citation: "Chakrabarti & Singh 2022, World J Psychiatry",
    doi: "10.5498/wjp.v12.i9.1204",
  },
  grandiose: {
    tier: "meta-analysis",
    summary:
      "Grandiose delusions present in ~57% of current manic episodes (pooled across 17 studies in a 339-study review; corroborated by a 54-study meta-analysis, n=23,461, with BDI lifetime psychotic-symptom prevalence 63%). The existing strong positive mania weight is confirmed by the evidence — no value change; this entry documents provenance for a weight that was already correct.",
    citation:
      "Chakrabarti & Singh 2022, World J Psychiatry; Aminoff et al. 2022, Psychol Med",
    doi: "10.1017/S003329172200201X",
  },
};

// ============================================================
// Scoring
// ============================================================
type Feature = {
  id: string;
  label: string;
  weights?: Partial<Record<DxId, number>>;
  redFlag?: string;
  rules_in?: string;
  group?: string;
};
type Contribution = { feature: string; weight: number };

function scoreAll(activeFeatures: Feature[]) {
  const dxScores: Record<DxId, number> = Object.fromEntries(DIAGNOSES.map((d) => [d.id, d.base]));
  const dxContrib: Record<DxId, Contribution[]> = Object.fromEntries(DIAGNOSES.map((d) => [d.id, []]));
  const triggeredFlags = new Set<string>();
  const ruledIn = new Set<string>();
  const activeIds = new Set(activeFeatures.map((f) => f.id));

  for (const f of activeFeatures) {
    if (f.weights) {
      for (const [dxKey, w] of Object.entries(f.weights)) {
        const dx = dxKey as DxId;
        if (dxScores[dx] !== undefined) {
          dxScores[dx] += w as number;
          dxContrib[dx].push({ feature: f.label, weight: w as number });
        }
      }
    }
    if (f.redFlag) triggeredFlags.add(f.redFlag);
    if (f.rules_in) ruledIn.add(f.rules_in);
  }

  // Combo rules — flags that depend on multiple features being present.
  // Late-life first-episode psychosis carries a high prior for
  // neurodegenerative or medical etiology regardless of where primary
  // psychiatric Dx ranks in the scoreboard.
  if (activeIds.has("age_over60") && activeIds.has("first_episode")) {
    triggeredFlags.add("neurodegen_workup");
  }

  // Charles Bonnet pattern: visual hallucinations + visual impairment +
  // intact insight, AND absence of features that would indicate a primary
  // or organic psychotic process. The absence clause is what distinguishes
  // Charles Bonnet from DLB/late-onset psychosis in a visually impaired
  // patient — without it, this would misfire on a DLB patient who also
  // happens to have cataracts.
  const cbExclusionary = [
    "thought_insertion", "delusions_control", "grandiose", "reference",
    "guilt_punishment", "persecutory", "capgras", "infant_centered",
    "monothematic_systematized", "neg_symptoms", "disorganized_speech",
    "catatonia", "cognitive_decline", "parkinsonism", "fluctuating_attention",
  ];
  const cbHasExclusion = cbExclusionary.some((id) => activeIds.has(id));
  if (
    (activeIds.has("visual_inanimate") || activeIds.has("visual_complex")) &&
    activeIds.has("visual_impairment") &&
    activeIds.has("intact_insight") &&
    !cbHasExclusion
  ) {
    triggeredFlags.add("charles_bonnet");
  }

  // Convert ordinal scores to softmax-like probabilities for display.
  // Temperature chosen so a 3-point gap ≈ ~3x odds — communicates
  // ranking without implying calibrated probability.
  const temp = 1.4;
  const exps = DIAGNOSES.map((d) => Math.exp(dxScores[d.id] / temp));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = DIAGNOSES.map((d, i) => ({
    ...d,
    raw: dxScores[d.id],
    prob: exps[i] / sum,
    contrib: dxContrib[d.id].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    forcedIn: ruledIn.has(d.id),
  }));

  probs.sort((a, b) => {
    if (a.forcedIn && !b.forcedIn) return -1;
    if (!a.forcedIn && b.forcedIn) return 1;
    return b.raw - a.raw;
  });

  return { ranked: probs, redFlags: [...triggeredFlags] };
}

// ============================================================
// Narrative summary generation
// ============================================================
// Deterministic, template-based. PHI-free. Designed to drop into
// HPI / A&P prose. Mentions top 3 differential with reasoning,
// red flags triggered, and notable absences.

const PROSE_LABELS: Record<string, string> = {
  age_under18: "under 18 years old",
  age_18_30: "in the 18–30 age range",
  age_30_45: "in the 30–45 age range",
  age_45_60: "in the 45–60 age range",
  age_over60: "over 60 years old",
  sex_female: "female",
  sex_male: "male",
  currently_pregnant: "currently pregnant",
  within_year_postpartum: "within one year postpartum",
  fhx_scz: "a family history of schizophrenia",
  fhx_bipolar: "a family history of bipolar disorder",
  fhx_neurodegen: "a family history of dementia or FTD",
  fhx_autoimmune: "a family history of autoimmune disease",
  prior_psychosis: "prior psychotic episodes",
  first_episode: "presenting in a first lifetime episode",
  fluctuating_attention: "fluctuating attention with clouded sensorium",
  clear_sensorium: "a clear sensorium",
  cognitive_decline: "progressive cognitive and personality decline",
  perplexity: "perplexity with motor disturbance",
  hours_days: "onset over hours to days",
  polymorphic_2wk: "a polymorphic, rapidly shifting picture under two weeks",
  insidious_prodrome: "an insidious prodrome over weeks to months",
  postpartum_window: "onset within 1–14 days postpartum",
  mania_active: "an active manic episode",
  depression_active: "an active major depressive episode",
  psychosis_only_in_mood: "psychosis confined to mood episodes",
  psychosis_outside_mood: "psychosis persisting outside mood episodes",
  auditory_3p: "third-person auditory hallucinations",
  auditory_mood_congruent: "mood-congruent auditory hallucinations",
  auditory_condemning: "derogatory auditory hallucinations in clear sensorium",
  tactile_formication: "tactile hallucinations / formication",
  visual_inanimate: "visual hallucinations of inanimate objects",
  visual_complex: "complex visual hallucinations",
  multimodal: "multimodal hallucinations",
  thought_insertion: "thought insertion, withdrawal, or broadcasting",
  delusions_control: "delusions of control or passivity",
  grandiose: "grandiose delusions",
  reference: "delusions of reference",
  guilt_punishment: "delusions of guilt or deserved punishment",
  persecutory: "persecutory delusions",
  capgras: "Capgras or misidentification delusions",
  infant_centered: "infant-centered delusions",
  monothematic_systematized: "a single systematized non-bizarre delusion",
  neg_symptoms: "negative symptoms",
  disorganized_speech: "disorganized speech and formal thought disorder",
  catatonia: "catatonic features",
  stimulant_use: "recent stimulant use",
  alcohol_heavy: "heavy alcohol use or withdrawal context",
  no_substance: "negative substance history with negative tox screen",
  fever: "fever",
  seizure: "seizure activity",
  dyskinesia_mutism: "orofacial dyskinesia, mutism, or speech disintegration",
  abnormal_vitals: "abnormal vital signs",
  autoimmune_hx: "a personal history of autoimmune disease",
  parkinsonism: "parkinsonism",
  focal_neuro: "focal neurologic deficit",
};

const proseLabel = (f: Feature): string => PROSE_LABELS[f.id] ?? f.label.toLowerCase();

const featureIdByLabel: Record<string, string> = {};
for (const g of FEATURES) {
  for (const it of g.items) {
    featureIdByLabel[it.label] = it.id;
  }
}

function generateSummary(activeFeatures: Feature[], ranked: any[], redFlags: string[], allFeatures: Feature[]): string {
  if (activeFeatures.length === 0) {
    return "No features selected. Toggle features at left to populate the differential.";
  }

  const formatList = (items: string[]): string => {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  };

  const demoIsAttrs = ["age_under18", "age_18_30", "age_30_45", "age_45_60", "age_over60", "sex_female", "sex_male", "currently_pregnant", "within_year_postpartum"];
  const demoHxAttrs = ["fhx_scz", "fhx_bipolar", "fhx_neurodegen", "fhx_autoimmune", "prior_psychosis", "first_episode"];

  const demoIs: string[] = [];
  const demoHx: string[] = [];
  const byGroup: Record<string, string[]> = {};

  for (const f of activeFeatures) {
    if (demoIsAttrs.includes(f.id)) demoIs.push(proseLabel(f));
    else if (demoHxAttrs.includes(f.id)) demoHx.push(proseLabel(f));
    else {
      const g = f.group ?? "Other";
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(proseLabel(f));
    }
  }

  const demoClauses: string[] = [];
  if (demoIs.length > 0) {
    demoClauses.push(`Patient is ${formatList(demoIs)}.`);
  }
  if (demoHx.length > 0) {
    demoClauses.push(`Relevant history includes ${formatList(demoHx)}.`);
  }

  const featureClauses: string[] = [];
  const groupOrder: [string, string][] = [
    ["Sensorium & cognition", "Mental status reveals"],
    ["Onset & tempo", "Course is notable for"],
    ["Mood episode coupling", "Mood findings include"],
    ["Hallucinations", "Perceptual disturbance includes"],
    ["Delusions", "Delusional content includes"],
    ["Disorganization & negative symptoms", "Other findings include"],
    ["Substance & exposure history", "Substance history is significant for"],
    ["Neurologic & systemic red flags", "Notable medical findings include"],
  ];
  for (const [g, lead] of groupOrder) {
    if (!byGroup[g]) continue;
    featureClauses.push(`${lead} ${formatList(byGroup[g])}.`);
  }

  const top = ranked[0];
  const considered = ranked.slice(0, 3).filter((dx: any, i: number) => i === 0 || dx.prob >= 0.01);

  const dxClauses: string[] = [];
  considered.forEach((dx: any, i: number) => {
    if (dx.contrib.length === 0) return;
    const positives = dx.contrib.filter((c: Contribution) => c.weight > 0).slice(0, 3);
    const negatives = dx.contrib.filter((c: Contribution) => c.weight < 0).slice(0, 2);
    const positiveLabels = positives.map((c: Contribution) => contribProseLabel(c, activeFeatures));
    const negativeLabels = negatives.map((c: Contribution) => contribProseLabel(c, activeFeatures));
    const rank = i === 0 ? "Leading consideration" : i === 1 ? "Second consideration" : "Third consideration";
    let s = `${rank} is ${dx.label} (${(dx.prob * 100).toFixed(1)}%`;
    if (dx.forcedIn) s += ", ruled in by feature";
    s += ")";
    if (positiveLabels.length > 0) {
      s += `, supported by ${formatList(positiveLabels)}`;
    }
    if (negativeLabels.length > 0) {
      s += `; argued against by ${formatList(negativeLabels)}`;
    }
    s += ".";
    dxClauses.push(s);
  });

  const flagClauses: string[] = [];
  if (redFlags.length > 0) {
    const flagLabels = redFlags.map((id: string) => RED_FLAGS[id as keyof typeof RED_FLAGS]?.label).filter(Boolean) as string[];
    flagClauses.push(`Red flags identified: ${formatList(flagLabels)}.`);
    const critical = redFlags.find((id: string) => RED_FLAGS[id as keyof typeof RED_FLAGS]?.severity === "critical");
    const flagToDetail = critical || redFlags[0];
    if (flagToDetail && RED_FLAGS[flagToDetail as keyof typeof RED_FLAGS]) {
      flagClauses.push(`Recommended workup: ${RED_FLAGS[flagToDetail as keyof typeof RED_FLAGS].detail}`);
    }
  }

  const activeIds = new Set(activeFeatures.map((f) => f.id));
  const topDxId = top?.id;
  const competitorIds = considered.slice(1).map((d: any) => d.id);
  const notableAbsent: string[] = [];
  if (topDxId) {
    for (const f of allFeatures) {
      if (activeIds.has(f.id)) continue;
      if (f.group === "Demographics & history") continue;
      const wTop = (f.weights as any)?.[topDxId] ?? 0;
      if (wTop <= -2) {
        notableAbsent.push(proseLabel(f));
        continue;
      }
      if (wTop <= 0) {
        for (const cId of competitorIds) {
          const wC = (f.weights as any)?.[cId] ?? 0;
          if (wC >= 3) {
            notableAbsent.push(proseLabel(f));
            break;
          }
        }
      }
    }
  }
  let absenceClause = "";
  if (notableAbsent.length > 0) {
    const shown = notableAbsent.slice(0, 4);
    absenceClause = `Notably absent are ${formatList(shown)}${notableAbsent.length > 4 ? ", among other features that would shift the differential" : ""}.`;
  }

  const parts = [
    demoClauses.join(" "),
    featureClauses.join(" "),
    dxClauses.join(" "),
    flagClauses.join(" "),
    absenceClause,
    "This ranking is generated by a semi-quantitative decision-support tool using ordinal feature weights; it represents relative prioritization of the differential rather than a calibrated diagnostic posterior. Clinical judgment supersedes tool output.",
  ].filter(Boolean);

  return parts.join(" ");
}

function contribProseLabel(contrib: Contribution, activeFeatures: Feature[]): string {
  const f = activeFeatures.find((af: Feature) => af.label === contrib.feature);
  return f ? proseLabel(f) : contrib.feature.toLowerCase();
}

// ============================================================
// UI
// ============================================================
export default function PsychosisDx() {
  const [active, setActive] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<string>("dx");
  const [openDx, setOpenDx] = useState<string | null>(null);

  const allFeatures: Feature[] = useMemo(
    () => FEATURES.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))),
    []
  );

  const activeFeatures = useMemo(
    () => allFeatures.filter((f: Feature) => active.has(f.id)),
    [active, allFeatures]
  );

  const { ranked, redFlags } = useMemo(() => scoreAll(activeFeatures), [activeFeatures]);

  const summary = useMemo(
    () => generateSummary(activeFeatures, ranked, redFlags, allFeatures),
    [activeFeatures, ranked, redFlags, allFeatures]
  );

  const [copied, setCopied] = useState<boolean>(false);
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = summary;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      document.body.removeChild(ta);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setActive(next);
  };

  const reset = () => {
    setActive(new Set());
    setOpenDx(null);
  };

  const topProb = ranked[0]?.prob ?? 0;

  return (
    <div style={{ fontFamily: "'Fraunces', Georgia, serif", background: "#f5f2ea", minHeight: "100vh", color: "#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        button { font-family: inherit; cursor: pointer; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .feat-btn {
          display: block; width: 100%; text-align: left; padding: 7px 10px;
          background: transparent; border: 1px solid #d6cfbe; border-radius: 0;
          font-size: 13px; color: #2a2a2a; transition: all 0.12s;
          margin-bottom: -1px; line-height: 1.35;
        }
        .feat-btn:hover { background: #ebe4d2; }
        .feat-btn.active { background: #1a1a1a; color: #f5f2ea; border-color: #1a1a1a; position: relative; z-index: 1; }
        .feat-btn.active:hover { background: #2a2a2a; }
        .group-panel {
          background: #fdfbf4;
          border: 1px solid #d6cfbe;
          border-left: 3px solid #1a1a1a;
          padding: 12px 14px 10px;
          margin-bottom: 12px;
        }
        .group-panel:last-child { margin-bottom: 0; }
        .group-label {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
          letter-spacing: -0.005em;
          margin: 0 0 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid #e5dfce;
        }
        .dx-row {
          display: grid; grid-template-columns: 1fr auto auto;
          gap: 12px; align-items: center;
          padding: 10px 12px; border-bottom: 1px solid #e5dfce;
          cursor: pointer; transition: background 0.12s;
        }
        .dx-row:hover { background: #ebe4d2; }
        .dx-row.top { background: #1a1a1a; color: #f5f2ea; }
        .dx-row.top:hover { background: #2a2a2a; }
        .dx-row.forced { border-left: 3px solid #b94a48; }
        .bar-wrap { width: 100px; height: 6px; background: rgba(0,0,0,0.08); border-radius: 0; overflow: hidden; }
        .dx-row.top .bar-wrap { background: rgba(245,242,234,0.15); }
        .bar-fill { height: 100%; background: #1a1a1a; transition: width 0.3s ease; }
        .dx-row.top .bar-fill { background: #f5f2ea; }
        .tab-btn {
          padding: 8px 16px; background: transparent; border: none;
          font-family: 'JetBrains Mono', monospace; font-size: 11px;
          text-transform: uppercase; letter-spacing: 0.1em;
          color: #6b6258; border-bottom: 2px solid transparent;
          margin-bottom: -1px;
        }
        .tab-btn.active { color: #1a1a1a; border-bottom-color: #1a1a1a; }
        .flag {
          padding: 10px 12px; margin-bottom: 8px;
          border-left: 3px solid #b94a48; background: #fbf1ef;
          font-size: 13px; line-height: 1.45;
        }
        .flag.critical { border-left-color: #7a1f1d; background: #f5e2df; }
        .flag-label {
          font-family: 'JetBrains Mono', monospace; font-size: 10px;
          font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
          color: #7a1f1d; display: block; margin-bottom: 4px;
        }
        .contrib-row {
          display: flex; justify-content: space-between; gap: 12px;
          padding: 4px 0; font-size: 12px; line-height: 1.4;
          border-bottom: 1px dotted #d6cfbe;
        }
        .contrib-row:last-child { border-bottom: none; }
        .w-pos { color: #2a5a3a; font-weight: 600; }
        .w-neg { color: #b94a48; font-weight: 600; }
        @media (max-width: 900px) {
          .layout { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px 64px" }}>
        {/* Header */}
        <header style={{ borderBottom: "1px solid #1a1a1a", paddingBottom: 16, marginBottom: 24, display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: "-0.02em", fontVariationSettings: "'opsz' 100" }}>
              Psychosis Differential
            </h1>
            <div className="mono" style={{ fontSize: 11, color: "#6b6258", marginTop: 4, letterSpacing: "0.05em" }}>
              SEMI-QUANTITATIVE ETIOLOGIC SCORING · POINT-OF-CARE
            </div>
          </div>
          <button onClick={reset} className="mono" style={{ fontSize: 11, padding: "6px 14px", background: "transparent", border: "1px solid #1a1a1a", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Reset
          </button>
        </header>

        {/* Calibration disclaimer */}
        <div style={{ background: "#fdf8e8", border: "1px solid #d6cfbe", padding: "10px 14px", marginBottom: 24, fontSize: 12, lineHeight: 1.5, color: "#4a4338" }}>
          <strong style={{ fontWeight: 600 }}>Calibration note.</strong> Weights are ordinal and reflect literature where published LRs exist (visual hallucinations ~3× more common in secondary psychosis; ~62% grandiose delusions in mania) and the reference document's framing elsewhere. Probabilities shown are <em>relative ranking</em>, not calibrated posteriors. Red-flag layer operates independently of scoring. Decision support only — not a substitute for clinical judgment. Weights marked EV in the score breakdown are anchored to cited literature; the majority are expert-judgment calibration and have not been validated against clinical outcomes. The evidence layer now reflects two literature passes; it confirms some weights and corrects others, but covers only a small fraction of all weights.
        </div>

        <div className="layout" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 32 }}>
          {/* LEFT: Feature picker */}
          <div>
            <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b6258", marginBottom: 4 }}>
              Step 1
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>
              Toggle features present
            </h2>

            <div style={{ background: "#fff", padding: 14, border: "1px solid #d6cfbe" }}>
              {FEATURES.map((g) => (
                <div key={g.group} className="group-panel">
                  <div className="group-label">{g.group}</div>
                  {g.items.map((f) => (
                    <button
                      key={f.id}
                      className={"feat-btn " + (active.has(f.id) ? "active" : "")}
                      onClick={() => toggle(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Output */}
          <div>
            <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b6258", marginBottom: 4 }}>
              Step 2
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>
              Differential & flags
            </h2>

            {/* Red flags appear above everything else */}
            {redFlags.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "#7a1f1d", marginBottom: 8, fontWeight: 600 }}>
                  ⚠ Red-flag triggers
                </div>
                {redFlags.map((id: string) => {
                  const flag = RED_FLAGS[id as keyof typeof RED_FLAGS];
                  return (
                    <div key={id} className={"flag " + (flag.severity === "critical" ? "critical" : "")}>
                      <span className="flag-label">{flag.label}</span>
                      <span>{flag.detail}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tabs */}
            <div style={{ borderBottom: "1px solid #d6cfbe", marginBottom: 0, display: "flex", gap: 4 }}>
              <button className={"tab-btn " + (tab === "dx" ? "active" : "")} onClick={() => setTab("dx")}>
                Ranked Dx
              </button>
              <button className={"tab-btn " + (tab === "summary" ? "active" : "")} onClick={() => setTab("summary")}>
                Summary
              </button>
              <button className={"tab-btn " + (tab === "ref" ? "active" : "")} onClick={() => setTab("ref")}>
                Reference
              </button>
              <button className={"tab-btn " + (tab === "active" ? "active" : "")} onClick={() => setTab("active")}>
                Active features ({activeFeatures.length})
              </button>
            </div>

            {tab === "dx" && (
              <div style={{ background: "#fff", border: "1px solid #d6cfbe", borderTop: "none" }}>
                {activeFeatures.length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", color: "#6b6258", fontSize: 13, fontStyle: "italic" }}>
                    Toggle features at left to populate the differential.
                  </div>
                ) : (
                  ranked.slice(0, 10).map((dx: any, i: number) => {
                    const isTop = i === 0;
                    const barW = topProb > 0 ? (dx.prob / topProb) * 100 : 0;
                    const isOpen = openDx === dx.id;
                    return (
                      <div key={dx.id}>
                        <div
                          className={"dx-row " + (isTop ? "top " : "") + (dx.forcedIn ? "forced" : "")}
                          onClick={() => setOpenDx(isOpen ? null : dx.id)}
                        >
                          <div>
                            <div style={{ fontSize: 14, fontWeight: isTop ? 600 : 500, lineHeight: 1.3 }}>
                              {dx.label}
                            </div>
                            <div className="mono" style={{ fontSize: 10, opacity: 0.65, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              {dx.category}
                              {dx.forcedIn && " · ruled in by feature"}
                            </div>
                          </div>
                          <div className="bar-wrap">
                            <div className="bar-fill" style={{ width: `${Math.max(0, barW)}%` }} />
                          </div>
                          <div className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 48, textAlign: "right" }}>
                            {(dx.prob * 100).toFixed(1)}%
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ padding: "12px 16px 16px", background: "#faf6ec", borderBottom: "1px solid #e5dfce" }}>
                            <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b6258", marginBottom: 8 }}>
                              Score breakdown · raw {dx.raw >= 0 ? "+" : ""}{dx.raw}
                            </div>
                            {dx.contrib.length === 0 ? (
                              <div style={{ fontSize: 12, fontStyle: "italic", color: "#6b6258" }}>No active features touch this diagnosis.</div>
                            ) : (
                              dx.contrib.map((c: Contribution, j: number) => {
                                const evId = featureIdByLabel[c.feature];
                                const ev = evId ? WEIGHT_EVIDENCE[evId] : undefined;
                                return (
                                  <div key={j} className="contrib-row">
                                    <span>{c.feature}</span>
                                    <span style={{ display: "inline-flex", alignItems: "center" }}>
                                      <span className={c.weight > 0 ? "w-pos" : "w-neg"}>
                                        {c.weight > 0 ? "+" : ""}{c.weight}
                                      </span>
                                      {ev && (
                                        <span
                                          title={`${ev.summary} — ${ev.citation}`}
                                          className="mono"
                                          style={{
                                            fontSize: 9,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.06em",
                                            color: "#2a5a3a",
                                            border: "1px solid #2a5a3a",
                                            padding: "1px 4px",
                                            marginLeft: 8,
                                            cursor: "help",
                                          }}
                                        >
                                          EV
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                            <div className="mono" style={{ fontSize: 9, color: "#6b6258", marginTop: 8, letterSpacing: "0.05em" }}>
                              EV = weight anchored to published evidence (hover for source). Unmarked weights are expert-judgment calibration.
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "summary" && (
              <div style={{ background: "#fff", border: "1px solid #d6cfbe", borderTop: "none", padding: 16 }}>
                {activeFeatures.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#6b6258", fontSize: 13, fontStyle: "italic" }}>
                    Toggle features at left to generate a documentation summary.
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b6258" }}>
                        Documentation summary · PHI-free narrative
                      </div>
                      <button
                        onClick={copySummary}
                        className="mono"
                        style={{
                          fontSize: 10, padding: "5px 12px",
                          background: copied ? "#2a5a3a" : "#1a1a1a",
                          color: "#f5f2ea", border: "none",
                          textTransform: "uppercase", letterSpacing: "0.08em",
                          transition: "background 0.2s",
                        }}
                      >
                        {copied ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                    <div style={{
                      fontSize: 13, lineHeight: 1.65, color: "#1a1a1a",
                      fontFamily: "'Fraunces', Georgia, serif",
                      background: "#faf6ec", padding: "14px 16px",
                      border: "1px solid #e5dfce",
                      whiteSpace: "pre-wrap",
                    }}>
                      {summary}
                    </div>
                    <div style={{ marginTop: 12, fontSize: 11, color: "#6b6258", fontStyle: "italic", lineHeight: 1.5 }}>
                      Paste into your note and add patient-specific context. The tool intentionally does not accept patient identifiers.
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === "ref" && (
              <div style={{ background: "#fff", border: "1px solid #d6cfbe", borderTop: "none", padding: 16, fontSize: 13, lineHeight: 1.55 }}>
                <ReferenceContent />
              </div>
            )}

            {tab === "active" && (
              <div style={{ background: "#fff", border: "1px solid #d6cfbe", borderTop: "none", padding: 16, fontSize: 13 }}>
                {activeFeatures.length === 0 ? (
                  <div style={{ color: "#6b6258", fontStyle: "italic" }}>None toggled.</div>
                ) : (
                  activeFeatures.map((f: Feature) => (
                    <div key={f.id} style={{ padding: "6px 0", borderBottom: "1px dotted #d6cfbe" }}>
                      <span className="mono" style={{ fontSize: 10, color: "#6b6258", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 8 }}>
                        {(f.group ?? "").split(" ")[0]}
                      </span>
                      {f.label}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="mono" style={{ marginTop: 48, paddingTop: 16, borderTop: "1px solid #d6cfbe", fontSize: 10, color: "#6b6258", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Built from ICD-11 / WKL / Kraepelin framing · evidence-graded weights · v0.6
        </footer>
      </div>
    </div>
  );
}

function ReferenceContent() {
  const blocks = [
    {
      h: "Modality cross-table",
      rows: [
        ["Schizophrenia", "Auditory 3rd-person", "Thought insertion / control", "Chronic cognitive deficit"],
        ["Bipolar mania", "Auditory mood-congruent", "Grandiose / altruistic", "Episodic impairment"],
        ["Meth (transient)", "Tactile / formication", "Persecutory", "Alert, agitated"],
        ["Alcohol AIPD", "Auditory voices", "Persecutory", "Clear sensorium"],
        ["Anti-NMDA", "Visual / auditory", "Paranoid / bizarre", "Severe memory loss"],
        ["NPSLE", "Visual / tactile", "Persecutory", "Acute fluctuating confusion"],
      ],
    },
  ];
  return (
    <div>
      <p style={{ marginTop: 0 }}>
        Phenomenological cross-reference. Use against the active scoring rather than as a standalone lookup.
      </p>
      {blocks.map((b) => (
        <div key={b.h} style={{ marginBottom: 16 }}>
          <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b6258", marginBottom: 6 }}>
            {b.h}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>Etiology</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>Hallucination</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>Delusional theme</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>Sensorium</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px dotted #d6cfbe" }}>
                  {r.map((c, j) => (
                    <td key={j} style={{ padding: "6px 8px", verticalAlign: "top" }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b6258", marginBottom: 6, marginTop: 20 }}>
        Recommended workup
      </div>
      <p style={{ margin: "0 0 8px" }}>
        <strong>First-line first-episode:</strong> CBC, BMP, TFTs, urine tox, RPR.
      </p>
      <p style={{ margin: "0 0 8px" }}>
        <strong>If atypical:</strong> brain MRI, EEG, LP for CSF (NMDAR Ab — CSF more sensitive than serum).
      </p>
      <p style={{ margin: "0 0 8px" }}>
        <strong>Endocrine screen:</strong> TFTs, AM cortisol / dex suppression if Cushing suspected.
      </p>
      <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b6258", marginBottom: 6, marginTop: 20 }}>
        WKL framing
      </div>
      <p style={{ margin: "0 0 8px" }}>
        <strong>Cycloid psychosis</strong> — acute polymorphic, intraphasic bipolarity (ecstasy/anxiety, motion/stupor), full recovery.
      </p>
      <p style={{ margin: "0 0 8px" }}>
        <strong>Unsystematic schizophrenias</strong> — episodic w/ partial remission (periodic catatonia, cataphasia, affective paraphrenia).
      </p>
      <p style={{ margin: 0 }}>
        <strong>Systematic schizophrenias</strong> — progressive, monomorphic residual (parakinetic catatonia, silly hebephrenia, paraphrenias).
      </p>
    </div>
  );
}
