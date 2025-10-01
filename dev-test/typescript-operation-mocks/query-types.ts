export interface CreateMessage_Message {
  id: string;
}

export interface GetMessages_Message {
  id: string;
  author: GetMessages_Author | null;
  date: Date | null;
}

export interface GetMessages_Author {
  name: string;
  adress: GetMessages_Adress | null;
}

export interface GetMessages_Adress {
  street: string;
  city: string;
  country: string | null;
}
