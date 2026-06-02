// Selects the local Study Pack generator.
//
// The public core does not include private backend clients, AI providers, or
// secrets. Downstream apps can provide their own remote generator and keep
// provider keys server-side.
import { localGenerator } from "./generator";
import type { StudyGenerator } from "./generator";

export function getStudyGenerator(): StudyGenerator {
  return localGenerator;
}

export function studyAiEnabled(): boolean {
  return false;
}

