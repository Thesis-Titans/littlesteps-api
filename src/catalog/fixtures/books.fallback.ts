import type { BookItem } from "../types.js";

export const FALLBACK_BOOKS: BookItem[] = [
  {
    id: "OL7835968W",
    title: "The Very Hungry Caterpillar",
    authors: ["Eric Carle"],
    coverUrl: "https://covers.openlibrary.org/b/id/7835968-M.jpg",
    subjects: ["Caterpillars", "Metamorphosis", "Picture books"]
  },
  {
    id: "OL262758W",
    title: "Goodnight Moon",
    authors: ["Margaret Wise Brown"],
    coverUrl: "https://covers.openlibrary.org/b/id/8231996-M.jpg",
    subjects: ["Bedtime", "Stories in rhyme", "Rabbits"]
  },
  {
    id: "OL868239W",
    title: "Brown Bear, Brown Bear, What Do You See?",
    authors: ["Bill Martin Jr.", "Eric Carle"],
    coverUrl: "https://covers.openlibrary.org/b/id/8315124-M.jpg",
    subjects: ["Colors", "Animals", "Repetitive text"]
  }
];
