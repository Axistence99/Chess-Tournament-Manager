import type { Player } from "../models";
import { categoryForAge } from "../utils/player";

/**
 * Starter profiles requested for new installations.
 * A rating of zero represents an unrated player until an organizer edits it.
 * Stable IDs prevent duplicate records during migrations and repeated startup.
 */
export const PRESET_PLAYERS: Player[] = [
  {
    id: "preset-papa",
    name: "Papa",
    age: 40,
    rating: 0,
    country: "PHI",
    club: "",
    fideId: "",
    ageCategory: categoryForAge(40),
    active: true,
  },
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
];
