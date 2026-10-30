import type { BookItem } from "../types.js";

// IDs checked against openlibrary.org on 2026-10-30.
export const FALLBACK_BOOKS: BookItem[] = [
  {
    id: "OL52987W",
    title: "The Very Hungry Caterpillar",
    authors: ["Eric Carle"],
    coverUrl: "https://covers.openlibrary.org/b/id/7835968-M.jpg",
    subjects: ["Caterpillars", "Metamorphosis", "Picture books"]
  },
  {
    id: "OL151798W",
    title: "Goodnight Moon",
    authors: ["Margaret Wise Brown"],
    coverUrl: "https://covers.openlibrary.org/b/id/35556-M.jpg",
    subjects: ["Bedtime", "Stories in rhyme", "Rabbits"]
  },
  {
    id: "OL59133W",
    title: "Brown Bear, Brown Bear, What Do You See?",
    authors: ["Bill Martin Jr."],
    coverUrl: "https://covers.openlibrary.org/b/id/12624136-M.jpg",
    subjects: ["Colors", "Animals", "Repetitive text"]
  }
];
