/**
 * Harvest Losses' loss cap, kept on the device (`useStoredState`): the tab
 * reads it, and the Tax Center page prefetches the harvest with it.
 */
export const HARVEST_KEY = "beobeo.tax.harvest";

export type HarvestState = { capInput: string; cap: number | null };

export const HARVEST_DEFAULT: HarvestState = { capInput: "", cap: null };
