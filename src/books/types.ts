export interface StoredBook {
  id: string;
  childId: string;
  caregiverId: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  subjects: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicBook {
  id: string;
  childId: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  subjects: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BooksListResponse {
  books: PublicBook[];
  totalCount: number;
}
