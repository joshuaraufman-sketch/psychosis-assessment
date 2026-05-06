# Psychosis Differential — Next.js scaffold

Bayesian-style symptom scoring tool for psychosis differential diagnosis.
Educational use only — not FDA-cleared, not validated against clinical outcomes.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

```bash
# from the project root
npx vercel
# or push to GitHub and import via the Vercel dashboard
```

If you want this on a custom subdomain (e.g. `psychosis-dx.cypnosis.com` or
similar), add the domain in the Vercel project settings under Domains.

## Project structure

```
app/
  layout.tsx        # Root layout, metadata, noindex robots
  page.tsx          # Mounts the component
components/
  PsychosisDx.tsx   # The actual tool — single self-contained component
package.json
tsconfig.json
next.config.js
```

## Calibration notes

Weights are ordinal (semi-quantitative) — not real likelihood ratios.
Weights reflect:
- Published numbers where available (~3x visual hallucinations in secondary
  psychosis; ~62% grandiose delusions in mania; postpartum window 1–14 days).
- Clinical framing from the WKL/Kraepelin/ICD-11 reference document
  elsewhere.

The probability display uses a softmax with temperature 1.4, calibrated so
a 3-point gap shows as roughly 3x odds. Ranking, not calibrated posteriors.

The red-flag layer runs independently of scoring: emergencies surface
regardless of where primary psychiatric diagnoses rank.

## Iterating

To add a feature: edit `FEATURES` in `components/PsychosisDx.tsx`.
Each feature object takes `{ id, label, weights: { dxId: weight, ... } }`
plus optional `redFlag` (a key into `RED_FLAGS`) or `rules_in` (forces
inclusion of a diagnosis when the feature is present).

To add a diagnosis: append to `DIAGNOSES` and add corresponding entries
across the `weights` maps in relevant features.

To add a combo-rule red flag: edit `scoreAll` — there's an example for
`age_over60 + first_episode → neurodegen_workup`.

## License

Private. Not for clinical use without proper validation.
