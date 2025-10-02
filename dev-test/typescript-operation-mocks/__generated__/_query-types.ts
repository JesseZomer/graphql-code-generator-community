export interface Mutation_CreateMessage {
  id: string;
}

export interface Query_Messages {
  id: string;
  author: Query_Messages_Author | null;
  date: Date | null;
  replyTo: Query_Messages_ReplyTo | null;
}

export interface Query_Messages_Author {
  name: string;
  adress: Query_Messages_Author_Adress | null;
}

export interface Query_Messages_ReplyTo {
  id: string;
  author: Query_Messages_ReplyTo_Author | null;
}

export interface Query_Messages_Author_Adress {
  street: string;
  city: string;
  country: string | null;
}

export interface Query_Messages_ReplyTo_Author {
  name: string;
}
