import { buildASTSchema, parse } from 'graphql';
import { describe, expect, it } from 'vitest';
import { plugin } from '../src';

describe('TypeScript Operation Mocks Plugin', () => {
  const schema = buildASTSchema(
    parse(/* GraphQL */ `
      type Message {
        id: String!
        description: String!
      }

      type Query {
        messages(tab: String!): [Message]
      }

      input CreateMessageInput {
        description: String!
      }

      type Mutation {
        createMessage(args: CreateMessageInput!): Message
        approve(id: ID!): Message
        decline(id: ID!, reason: String!): Message
        escalate(id: ID!): Message
      }

      schema {
        query: Query
        mutation: Mutation
      }
    `),
  );

  it('Should generate mock functions for query operations', async () => {
    const documents = [
      {
        document: parse(/* GraphQL */ `
          query GetMessages($tab: String!) {
            messages(tab: $tab) {
              id
            }
          }
        `),
      },
    ];

    const result = await plugin(schema, documents, {
      generateMocks: true,
      typesFile: '../types',
    });

    expect(result).toContain("import * as Types from '../types';");
    expect(result).toContain('export const fake_GetMessages');
    expect(result).toContain('(overrides?: Partial<Message>): Message');
    expect(result).toContain("id: 'id'");
  });

  it('Should generate mock functions for mutation operations', async () => {
    const documents = [
      {
        document: parse(/* GraphQL */ `
          mutation CreateMessage($args: CreateMessageInput!) {
            createMessage(args: $args) {
              id
              description
            }
          }
        `),
      },
    ];

    const result = await plugin(schema, documents, {
      generateMocks: true,
      typesFile: '../types',
    });

    expect(result).toContain('export const fake_CreateMessage');
    expect(result).toContain('(overrides?: Partial<Message>): Message');
  });

  it('Should handle multiple operations', async () => {
    const documents = [
      {
        document: parse(/* GraphQL */ `
          query GetMessages($tab: String!) {
            messages(tab: $tab) {
              id
            }
          }

          mutation Approve($id: ID!) {
            approve(id: $id) {
              id
            }
          }

          mutation Decline($id: ID!, $reason: String!) {
            decline(id: $id, reason: $reason) {
              id
            }
          }
        `),
      },
    ];

    const result = await plugin(schema, documents, {
      generateMocks: true,
      typesFile: '../types',
    });

    expect(result).toContain('fake_GetMessages');
    expect(result).toContain('fake_Approve');
    expect(result).toContain('fake_Decline');
  });

  it('Should handle multiple root fields by keeping the root field name', async () => {
    const multiFieldSchema = buildASTSchema(
      parse(/* GraphQL */ `
        type Message {
          id: String!
          description: String!
        }

        type User {
          id: String!
          name: String!
        }

        type Query {
          messages(tab: String!): [Message]
          users: [User]
        }
      `),
    );

    const documents = [
      {
        document: parse(/* GraphQL */ `
          query GetData($tab: String!) {
            messages(tab: $tab) {
              id
            }
            users {
              name
            }
          }
        `),
      },
    ];

    const result = await plugin(multiFieldSchema, documents, {
      generateMocks: true,
      typesFile: '../types',
    });

    // For multiple root fields, should keep the root field names
    expect(result).toContain('fake_GetData_messages');
    expect(result).toContain('fake_GetData_users');
  });

  it('Should handle operations without names gracefully', async () => {
    const documents = [
      {
        document: parse(/* GraphQL */ `
          {
            messages(tab: "test") {
              id
            }
          }
        `),
      },
    ];

    const result = await plugin(schema, documents, {
      generateMocks: true,
      typesFile: '../types',
    });

    // Should still generate imports but no mock functions for unnamed operations
    expect(result).toContain("import * as Types from '../types';");
    expect(result).not.toContain('export const fake');
  });

  it('Should generate TypeScript interfaces when generateQueryTypes is enabled', async () => {
    const documents = [
      {
        document: parse(/* GraphQL */ `
          query GetMessages($tab: String!) {
            messages(tab: $tab) {
              id
              description
            }
          }
        `),
      },
    ];

    const result = await plugin(schema, documents, {
      generateQueryTypes: true,
      generateMocks: false,
    });

    expect(result).toContain('export interface Query_GetMessages {');
    expect(result).toContain('  id: string;');
    expect(result).toContain('  description: string;');
    expect(result).toContain('}');
  });

  it('Should generate interfaces for multiple types in the same operation', async () => {
    const extendedSchema = buildASTSchema(
      parse(/* GraphQL */ `
        type Message {
          id: String!
          description: String!
          author: Author!
        }

        type Author {
          name: String!
          email: String!
        }

        type Query {
          messages(tab: String!): [Message]
        }
      `),
    );

    const documents = [
      {
        document: parse(/* GraphQL */ `
          query GetMessages($tab: String!) {
            messages(tab: $tab) {
              id
              description
              author {
                name
              }
            }
          }
        `),
      },
    ];

    const result = await plugin(extendedSchema, documents, {
      generateQueryTypes: true,
      generateMocks: false,
    });

    expect(result).toContain('export interface Query_GetMessages {');
    expect(result).toContain('export interface Query_GetMessages_Author {');
    expect(result).toContain('  name: string;');
    expect(result).not.toContain('  email: string;'); // email not selected
    expect(result).toContain('  author: Query_GetMessages_Author;'); // should reference generated interface, not schema type
  });
});
