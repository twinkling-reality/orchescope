/** The fixed shape every missing presentation slot carries. */
export interface PresentationRefusal {
  readonly title: string;
  readonly reason: string;
  readonly commands: readonly (readonly string[])[];
}

export const presentationRefusal = (
  title: string,
  reason: string,
  commands: readonly (readonly string[])[],
): PresentationRefusal => ({ title, reason, commands });
