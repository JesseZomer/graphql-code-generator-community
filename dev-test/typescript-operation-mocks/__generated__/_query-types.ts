export const TYPE = {
  COMMENT: 'COMMENT',
  POST: 'POST',
} as const;

export type TYPE = (typeof TYPE)[keyof typeof TYPE];

/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  LocalDate: { input: Date; output: Date };
};

export interface Mutation_CreateMessage {
  id: string;
}

export interface Query_Messages {
  __typename: 'Message';
  id: string;
  type: TYPE;
  active: boolean | null;
  numberOfComments: number | null;
  cost: number | null;
  authors: Query_Messages_Authors;
  date: Scalars['LocalDate']['output'] | null;
  replyTo: Query_Messages_ReplyTo | null;
}

export interface Query_Messages_Authors {
  __typename: 'Author';
  id: string;
  name: string;
}

export interface Query_Messages_ReplyTo {
  id: string;
  type: TYPE;
  authors: Query_Messages_ReplyTo_Authors;
}

export interface Query_Messages_ReplyTo_Authors {
  id: string;
  name: string;
}
