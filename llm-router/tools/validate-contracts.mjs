import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const openapiPath = resolve(root, 'contracts/openapi.yaml');
const api = await SwaggerParser.validate(openapiPath);
if (api.openapi !== '3.1.0') throw new Error(`Expected OpenAPI 3.1.0; got ${api.openapi}.`);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const name of ['meta', 'token', 'done', 'error', 'stats', 'benchmark-result']) {
  const schema = JSON.parse(await readFile(resolve(root, `contracts/schemas/${name}.schema.json`), 'utf8'));
  const fixture = JSON.parse(await readFile(resolve(root, `contracts/schemas/fixtures.${name}.json`), 'utf8'));
  const validate = ajv.compile(schema);
  if (!validate(fixture)) throw new Error(`${name} fixture failed schema validation: ${ajv.errorsText(validate.errors)}`);
}

for (const name of ['models.yaml', 'routing.yaml', 'server.yaml', 'gateway.yaml', 'frontend.yaml', 'bench.yaml']) {
  const value = parse(await readFile(resolve(root, `config/${name}`), 'utf8'));
  if (!value || typeof value !== 'object') throw new Error(`config/${name} did not parse to an object.`);
}
const models = parse(await readFile(resolve(root, 'config/models.yaml'), 'utf8')).models;
const routing = parse(await readFile(resolve(root, 'config/routing.yaml'), 'utf8'));
if (!Array.isArray(models) || models.length < 3) throw new Error('Model registry must include all configured tiers.');
for (const tier of ['light', 'code', 'heavy']) if (!models.some((model) => model.tier === tier)) throw new Error(`Missing model tier ${tier}.`);
const weightSum = Object.values(routing.classifier.weights).reduce((sum, value) => sum + value, 0);
if (Math.abs(weightSum - 1) > 0.01) throw new Error(`Classifier weights must sum to 1; got ${weightSum}.`);
if (!Number.isInteger(routing.classifier.reasoning_min_score) || routing.classifier.reasoning_min_score > 100) throw new Error('reasoning_min_score must be an integer from 0 to 100.');
if (!(routing.routing.light_max_score < routing.routing.heavy_min_score && routing.routing.heavy_min_score <= 100)) throw new Error('Tier thresholds must be ordered and at most 100.');

process.stdout.write(`OpenAPI 3.1 valid · ${Object.keys(api.paths).length} paths · 6 JSON fixtures · 6 YAML configs valid.\n`);
