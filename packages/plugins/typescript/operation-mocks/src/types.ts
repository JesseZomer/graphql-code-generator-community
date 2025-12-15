/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Queue item for breadth-first traversal of GraphQL selection sets.
 * Used by collectTypeSelectionsIteratively and its handler methods.
 */
export interface SelectionQueueItem {
    /** The selections to process (fields, inline fragments, fragment spreads) */
    selections: readonly any[];

    /** The GraphQL parent type these selections belong to */
    parentType: any;

    /** Current dot-separated path from operation root */
    contextPath: string;

    /**
     * For nested fields under interface/union variants, tracks the interface field name.
     * This helps with proper deduplication of nested types across interface variants.
     */
    interfaceFieldName?: string;
}

/**
 * Type selection information representing a GraphQL type and its selected fields.
 * Tracks which fields are queried for a specific type at a specific path in the operation.
 *
 * @example
 * ```typescript
 * // For query { messages { id, author { name } } }
 * const messageSelection: TypeFieldSelection = {
 *   typeName: 'Message',
 *   contextPath: 'messages',
 *   selectedFields: new Set(['id', 'author', '__typename'])
 * };
 *
 * const authorSelection: TypeFieldSelection = {
 *   typeName: 'Author',
 *   contextPath: 'messages.author',
 *   selectedFields: new Set(['name', '__typename'])
 * };
 * ```
 */
export interface TypeFieldSelection {
    /** The GraphQL type name (e.g., 'Message', 'Author', 'WeekToekenning') */
    typeName: string;

    /** Dot-separated path from operation root (e.g., 'messages', 'messages.author') */
    contextPath: string;

    /** Set of field names selected in the query for this type */
    selectedFields: Set<string>;

    /**
     * For interface/union types, the concrete implementing type (e.g., 'WeekToekenning').
     * This is set when the selection comes from an inline fragment on an interface/union.
     */
    concreteTypeName?: string;

    /**
     * For interface/union types, the order in which inline fragments appear.
     * Used to determine the "first" variant when generating type aliases.
     */
    inlineFragmentOrder?: number;

    /**
     * For nested fields under interface/union variants, the name of the interface/union field.
     * For example, if 'toekenningen' is an interface field, nested types under each variant
     * will have interfaceFieldName='toekenningen' to help with deduplication.
     */
    interfaceFieldName?: string;
}

/**
 * Context for processing a selection set during type traversal.
 * Represents a node in the breadth-first traversal queue.
 *
 * @example
 * ```typescript
 * const context: SelectionContext = {
 *   selections: operation.selectionSet.selections,
 *   parentType: schema.getQueryType(),
 *   contextPath: '',
 * };
 * ```
 */
export interface SelectionContext {
    /** The selections to process (fields, inline fragments, fragment spreads) */
    selections: readonly any[];

    /** The GraphQL parent type these selections belong to */
    parentType: any;

    /** Current dot-separated path from operation root */
    contextPath: string;

    /**
     * For nested fields under interface/union variants, tracks the interface field name.
     * This helps with proper deduplication of nested types across interface variants.
     */
    interfaceFieldName?: string;
}

/**
 * Configuration for generating a mock function.
 * Contains all the information needed to generate a single mock function.
 */
export interface MockFunctionConfig {
    /** Name of the generated function (e.g., 'fake_Messages', 'fake_Messages_author') */
    functionName: string;

    /** TypeScript interface name this function returns (e.g., 'QueryTypes.Query_Messages') */
    interfaceName: string;

    /** Generated mock fields code (the object literal body) */
    mockFields: string;

    /** Whether this function generates an array of items */
    isRootArrayField: boolean;

    /** Optional JSDoc comment for the function */
    jsDoc?: string;
}

/**
 * Information about the first occurrence of a nested type across operations.
 * Used for deduplication when generating type aliases - ensures nested types
 * with identical field selections reference the same TypeScript-operations type.
 *
 * @example
 * ```typescript
 * // If Author.address appears in multiple operations with same fields,
 * // we track the first occurrence and reuse its type name
 * const firstOccurrence: NestedTypeOccurrence = {
 *   operation: messagesOperation,
 *   operationName: 'Messages',
 *   operationType: 'query',
 *   contextPath: 'messages.author.address',
 *   typeName: 'Address'
 * };
 * ```
 */
export interface NestedTypeOccurrence {
    /** The operation definition where this nested type first appeared */
    operation: any;

    /** Name of the operation (e.g., 'Messages', 'CreatePost') */
    operationName: string;

    /** Type of operation ('query', 'mutation', 'subscription') */
    operationType: string;

    /** Full context path where the type appears */
    contextPath: string;

    /** The GraphQL type name */
    typeName: string;
}

/**
 * Aggregated data for an operation during type alias generation.
 * Groups all the information needed to process a single operation.
 */
export interface OperationData {
    /** The GraphQL operation definition node */
    operation: any;

    /** Converted operation name */
    operationName: string;

    /** Operation type ('query', 'mutation', 'subscription') */
    operationType: string;

    /** All type selections found in this operation */
    typeSelections: TypeFieldSelection[];

    /** Whether the operation has a single root field */
    hasSingleRoot: boolean;

    /** Name of the root field if hasSingleRoot is true */
    rootFieldName?: string;
}

/**
 * Optional logger interface for diagnostic output.
 * Allows plugin users to capture debug information without console pollution.
 *
 * @example
 * ```typescript
 * const logger: PluginLogger = {
 *   debug: (message, data) => {
 *     if (process.env.DEBUG_GRAPHQL_CODEGEN) {
 *       console.log(`[GraphQL Mock Gen] ${message}`, data);
 *     }
 *   }
 * };
 * ```
 */
export interface PluginLogger {
    /** Log debug-level diagnostic information */
    debug: (message: string, data?: any) => void;
}
