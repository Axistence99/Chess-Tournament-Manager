/** Starter profiles seeded into the reusable player directory on first use. */
import type { Player } from "../models";
import { categoryForAge } from "../utils/player";

/**
 * Starter profiles requested for new installations.
 * A rating of zero represents an unrated player until an organizer edits it.
 * Stable IDs prevent duplicate records during migrations and repeated startup.
 */
export const PRESET_PLAYERS: Player[] = [
  {
    id: "preset-xanjofish",
    name: "XanjoFish",
    age: 11,
    rating: 0,
    country: "JPN",
    club: "",
    fideId: "",
    ageCategory: categoryForAge(11),
    active: true,
  },
  {
    id: "preset-black-horse",
    name: "Black Horse",
    age: 19,
    rating: 0,
    country: "NGR",
    club: "",
    fideId: "",
    ageCategory: categoryForAge(19),
    active: true,
  },
  {
    id: "preset-joe",
    name: "Joe",
    age: 19,
    rating: 1600,
    country: "",
    club: "",
    fideId: "",
    ageCategory: categoryForAge(19),
    active: true,
  },
  {
    id: "preset-johnny",
    name: "Johnny",
    age: 32,
    rating: 1590,
    country: "",
    club: "",
    fideId: "",
    ageCategory: categoryForAge(32),
    active: true,
  },
  {
    id: "preset-hana",
    name: "Hana",
    age: 18,
    rating: 1642,
    country: "",
    club: "",
    fideId: "",
    ageCategory: categoryForAge(18),
    active: true,
  },
];

/** Profiles retired from the starter directory; referenced tournament data is preserved. */
export const RETIRED_PRESET_PLAYER_IDS = ["preset-papa"];
