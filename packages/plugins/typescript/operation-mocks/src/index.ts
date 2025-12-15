/* eslint-disable @typescript-eslint/no-explicit-any */
import { PluginFunction, Types } from '@graphql-codegen/plugin-helpers';
import {
    ClientSideBasePluginConfig,
    ClientSideBaseVisitor,
    LoadedFragment,
    RawClientSideBasePluginConfig
} from '@graphql-codegen/visitor-plugin-common';
import {
    FragmentDefinitionNode,
    getNamedType,
    GraphQLSchema,
    isEnumType,
    isInterfaceType,
    isObjectType,
    isUnionType,
    Kind,
    OperationDefinitionNode
} from 'graphql';
import type { SelectionQueueItem, TypeFieldSelection } from './types';
import { contextToCamelCase, contextToPascalCase, getBaseType, getPrimitiveMockValue, getScalarMockValue, isFieldListType } from './utils';

export interface OperationMocksPluginConfig extends RawClientSideBasePluginConfig {
    /**
     * Optional prefix for type names when referencing typescript-operations types
     * @default "Types."
     */
    typePrefix?: string;

    /**
     * Override default scalar type mappings for mock generation.
     */
    scalars?: any;

    /**
     * When true, generate type aliases instead of mock functions.
     * Type aliases map clean names (Query_Messages) to typescript-operations names (MessagesQuery_messages_Message).
     * @default false
     */
    generateTypeAliasesOnly?: boolean;
}

/**
 * Visitor class that extends ClientSideBaseVisitor to handle fragments across multiple documents.
 *
 * This visitor traverses GraphQL operations and their selection sets to generate mock functions
 * and type aliases. It handles:
 * - Fragment spreads and inline fragments
 * - Interface and union types with concrete type variants
 * - Nested object types
 * - Array fields
 * - Scalar and enum types
 *
 * @example
 * ```typescript
 * // For a GraphQL query like:
 * // query Messages { messages { id, text, author { name } } }
 *
 * // Generates mock functions:
 * // - fake_Messages(arrayIndex, overrides) - for Message[]
 * // - fake_Messages_author(arrayIndex, overrides) - for Author
 *
 * // Or type aliases (when generateTypeAliasesOnly: true):
 * // - export type Query_Messages = MessagesQuery_messages_Message;
 * // - export type Query_Messages_Author = MessagesQuery_messages_Message_author_Author;
 * ```
 */

/**
 * Lookup table for scalar list mock values.
 * Maps GraphQL scalar type names to functions that generate mock array values.
 */
const SCALAR_LIST_MOCKS: Record<string, (fieldName: string) => string> = {
    String: (f) => `['${f}_0', '${f}_1']`,
    ID: (f) => `['${f}_0', '${f}_1']`,
    Int: () => '[1, 2]',
    Float: () => '[1.0, 2.0]',
    Boolean: () => '[true, false]'
};

/**
 * Built-in GraphQL scalar types that don't need custom mock handling.
 */
const BUILT_IN_GRAPHQL_TYPES = ['ID', 'String', 'Boolean', 'Int', 'Float'] as const;

/**
 * Build a mock function name from operation name and context path.
 * @example buildFunctionName('Messages', 'author') => 'fake_Messages_author'
 * @example buildFunctionName('Messages', '') => 'fake_Messages'
 */
const buildFunctionName = (operationName: string, contextPath: string): string => {
    const suffix = contextToCamelCase(contextPath);
    return suffix ? `fake_${operationName}_${suffix}` : `fake_${operationName}`;
};

/**
 * Format a mock function call with proper array index handling.
 * Consolidates the repeated pattern of generating function calls with/without array indices.
 *
 * @param functionName - The mock function name to call
 * @param isArray - Whether this is an array field (generates two calls)
 * @param arrayIndex - Optional array index variable name (e.g., 'i')
 * @returns Formatted function call(s) as a string
 *
 * @example
 * formatMockFunctionCall('fake_Messages', false, undefined) => 'fake_Messages()'
 * formatMockFunctionCall('fake_Messages', false, 'i') => 'fake_Messages(undefined, `${i}`)'
 * formatMockFunctionCall('fake_Messages', true, undefined) => '[fake_Messages(undefined, \'0\'), fake_Messages(undefined, \'1\')]'
 * formatMockFunctionCall('fake_Messages', true, 'i') => '[fake_Messages(undefined, `${i}_0`), fake_Messages(undefined, `${i}_1`)]'
 */
const formatMockFunctionCall = (functionName: string, isArray: boolean, arrayIndex?: string): string => {
    if (isArray) {
        if (arrayIndex) {
            return `[${functionName}(undefined, \`\${${arrayIndex}}_0\`), ${functionName}(undefined, \`\${${arrayIndex}}_1\`)]`;
        }
        return `[${functionName}(undefined, '0'), ${functionName}(undefined, '1')]`;
    }
    if (arrayIndex) {
        return `${functionName}(undefined, \`\${${arrayIndex}}\`)`;
    }
    return `${functionName}()`;
};

class OperationMocksVisitor extends ClientSideBaseVisitor<OperationMocksPluginConfig, ClientSideBasePluginConfig> {
    private readonly _allFragments: Map<string, LoadedFragment>;
    private readonly _typePrefix: string;
    private readonly _scalarMockValues: Record<string, string>;

    constructor(
        schema: GraphQLSchema,
        fragments: LoadedFragment[],
        rawConfig: OperationMocksPluginConfig,
        documents: Types.DocumentFile[]
    ) {
        super(schema, fragments, rawConfig, {}, documents);

        this._allFragments = new Map(fragments.map((f) => [f.name, f]));
        this._typePrefix = rawConfig.typePrefix || 'Types.';
        this._scalarMockValues = rawConfig.scalars || {};
    }

    /**
     * Generate mock functions for all operations in the document.
     * Creates one function per type selection (including nested types).
     *
     * @returns Array of generated mock function code strings
     *
     * @example
     * ```typescript
     * // For query { vaksecties { id, naam, vakanties { naam } } }
     * // Returns:
     * // [
     * //   'export const fake_Vaksecties = (overrides, length) => ...',
     * //   'export const fake_Vaksecties_vakanties = (arrayIndex, overrides) => ...'
     * // ]
     * ```
     */
    generateMockFunctions(): string[] {
        const operations = this.extractOperations();

        if (operations.length === 0) {
            return [];
        }

        return operations.flatMap((operation) => {
            try {
                return this.createMockFunctionsForOperation(operation);
            } catch (error) {
                const operationName = operation.name?.value || 'unnamed';
                throw new Error(
                    `Failed to generate mock functions for operation "${operationName}": ${error instanceof Error ? error.message : String(error)}`
                );
            }
        });
    }

    /**
     * Extract all named operations from documents.
     * Filters out fragment definitions and operations without names.
     *
     * @returns Array of GraphQL operation definition nodes (queries, mutations, subscriptions)
     */
    private extractOperations(): OperationDefinitionNode[] {
        return this._documents
            .flatMap((doc) => doc.document?.definitions || [])
            .filter((def): def is OperationDefinitionNode => def.kind === Kind.OPERATION_DEFINITION)
            .filter((op) => op.name?.value);
    }

    /**
     * Create mock functions for an operation (one function per type selection).
     *
     * Analyzes the operation to find all type selections and generates a mock function
     * for each one. Groups type selections by their base context to identify interface/union
     * variants and adds JSDoc comments for variant functions.
     *
     * @param operation - The GraphQL operation to process
     * @returns Array of mock function code strings
     *
     * @example
     * ```typescript
     * // For: query Messages { messages { id, author { name } } }
     * // Returns array with 2 functions:
     * // - fake_Messages(arrayIndex, overrides) for Message[]
     * // - fake_Messages_author(arrayIndex, overrides) for Author
     * ```
     */
    private createMockFunctionsForOperation(operation: OperationDefinitionNode): string[] {
        const operationName = this.convertName(operation, {
            useTypesPrefix: false,
            useTypesSuffix: false
        });
        const typeSelections = this.findTypeSelections(operation);
        const { isSingle: hasSingleRoot, rootFieldName } = this.hasSingleRootField(operation);

        // Group type selections by their base context path (without concrete type suffix)
        // This helps us identify which selections are variants of the same interface/union field
        const selectionsByBaseContext = new Map<string, TypeFieldSelection[]>();

        typeSelections.forEach((selection) => {
            // Extract base context path (remove concrete type suffix if present)
            const parts = selection.contextPath.split('.');
            const baseContextPath = selection.concreteTypeName ? parts.slice(0, -1).join('.') : selection.contextPath;

            const existing = selectionsByBaseContext.get(baseContextPath);
            if (existing) {
                existing.push(selection);
            } else {
                selectionsByBaseContext.set(baseContextPath, [selection]);
            }
        });

        return typeSelections.map((typeSelection) => {
            // Find all variants for this type selection's base context
            const parts = typeSelection.contextPath.split('.');
            const baseContextPath = typeSelection.concreteTypeName ? parts.slice(0, -1).join('.') : typeSelection.contextPath;
            const variants = selectionsByBaseContext.get(baseContextPath) || [];

            return this.createMockFunctionForTypeSelection(
                operation,
                operationName,
                typeSelection,
                typeSelections,
                hasSingleRoot,
                rootFieldName,
                variants
            );
        });
    }

    /**
     * Create a single mock function for a type selection
     */
    private createMockFunctionForTypeSelection(
        operation: OperationDefinitionNode,
        operationName: string,
        typeSelection: TypeFieldSelection,
        allTypeSelections: TypeFieldSelection[],
        hasSingleRoot: boolean,
        rootFieldName: string | undefined,
        variants: TypeFieldSelection[]
    ): string {
        const adjustedContextPath = this.adjustContextPath(typeSelection.contextPath, hasSingleRoot, rootFieldName);

        const functionName = buildFunctionName(operationName, adjustedContextPath);

        const operationType = operation.operation;
        const basePrefix = operationType.charAt(0).toUpperCase() + operationType.slice(1);
        const interfaceName = `${this._typePrefix}${basePrefix}_${operationName}${contextToPascalCase(adjustedContextPath)}`;

        const isRootArrayField = this.checkIfRootArrayField(operation, hasSingleRoot, rootFieldName, adjustedContextPath);

        const mockFields = this.generateMockFields(
            typeSelection,
            operationName,
            allTypeSelections,
            hasSingleRoot,
            rootFieldName,
            isRootArrayField
        );

        // Generate JSDoc if this is one of multiple variants for an interface/union field
        let jsDoc = '';
        if (variants.length > 1 && typeSelection.concreteTypeName) {
            const otherVariants = variants
                .filter((v) => v.concreteTypeName !== typeSelection.concreteTypeName)
                .sort((a, b) => (a.inlineFragmentOrder || 0) - (b.inlineFragmentOrder || 0))
                .map((v) => {
                    const variantContextPath = this.adjustContextPath(v.contextPath, hasSingleRoot, rootFieldName);
                    return buildFunctionName(operationName, variantContextPath);
                });

            if (otherVariants.length > 0) {
                jsDoc = `/**\n * Mock function for ${typeSelection.concreteTypeName} variant.\n * This is one of ${variants.length} mock variants for this field.\n * See also: ${otherVariants.join(', ')}\n */\n`;
            }
        }

        return this.createMockFunctionCode(functionName, interfaceName, mockFields, isRootArrayField, jsDoc);
    }

    /**
     * Adjust context path for single root operations
     */
    private adjustContextPath(contextPath: string, hasSingleRoot: boolean, rootFieldName?: string): string {
        if (!hasSingleRoot || !rootFieldName || !contextPath.startsWith(rootFieldName)) {
            return contextPath;
        }
        return contextPath === rootFieldName ? '' : contextPath.substring(rootFieldName.length + 1);
    }

    /**
     * Get the root type for an operation from the schema.
     */
    private getRootTypeForOperation(operation: OperationDefinitionNode) {
        const rootTypes = {
            query: this._schema.getQueryType(),
            mutation: this._schema.getMutationType(),
            subscription: this._schema.getSubscriptionType()
        };
        return rootTypes[operation.operation];
    }

    /**
     * Check if root field is an array
     */
    private checkIfRootArrayField(
        operation: OperationDefinitionNode,
        hasSingleRoot: boolean,
        rootFieldName: string | undefined,
        adjustedContextPath: string
    ): boolean {
        if (!hasSingleRoot || !rootFieldName || adjustedContextPath !== '') return false;

        const operationRootType = this._schema.getRootType(operation.operation);
        if (!operationRootType) return false;

        const rootField = operationRootType.getFields()[rootFieldName];
        return rootField ? isFieldListType(rootField.type) : false;
    }

    /**
     * Generate mock fields for a type selection
     */
    private generateMockFields(
        typeSelection: TypeFieldSelection,
        operationName: string,
        allTypeSelections: TypeFieldSelection[],
        hasSingleRoot: boolean,
        rootFieldName: string | undefined,
        isRootArrayField: boolean
    ): string {
        // Always include __typename first
        const typenameField = `    __typename: '${typeSelection.typeName}'`;

        // Generate fields for all selected fields (excluding __typename if it's in the set)
        const selectedFields = Array.from(typeSelection.selectedFields)
            .filter((field) => field !== '__typename')
            .map((field) =>
                this.generateMockFieldValue(
                    typeSelection.typeName,
                    field,
                    operationName,
                    allTypeSelections,
                    typeSelection.contextPath,
                    hasSingleRoot,
                    rootFieldName,
                    isRootArrayField ? 'i' : undefined
                )
            )
            .filter((field) => field.trim().length > 0);

        return [typenameField, ...selectedFields].join(',\n');
    }

    /**
     * Generate mock value for a single field based on its GraphQL type.
     *
     * Handles different field types appropriately:
     * - Object types: Reference to another mock function
     * - Scalar types: Primitive values or custom scalar mock values
     * - Enum types: First enum value from schema
     * - Union types: Array of mock functions for each union member
     * - List types: Arrays with 2 items by default
     *
     * @param typeName - The parent GraphQL type name
     * @param fieldName - Name of the field to generate mock value for
     * @param operationName - Name of the current operation
     * @param allTypeSelections - All type selections in the operation (for finding nested types)
     * @param currentContextPath - Current path from operation root
     * @param hasSingleRoot - Whether operation has single root field
     * @param rootFieldName - Name of root field if hasSingleRoot is true
     * @param arrayIndex - Optional array index variable for nested array items
     * @returns TypeScript code string for the mock field value
     */
    private generateMockFieldValue(
        typeName: string,
        fieldName: string,
        operationName: string,
        allTypeSelections: TypeFieldSelection[],
        currentContextPath: string,
        hasSingleRoot: boolean,
        rootFieldName?: string,
        arrayIndex?: string
    ): string {
        // Validate schema type
        const schemaType = this._schema.getType(typeName);
        if (!schemaType || !isObjectType(schemaType)) {
            return `    ${fieldName}: '${fieldName}'`;
        }

        // Handle __typename special case
        if (fieldName === '__typename') {
            return `    ${fieldName}: '${typeName}'`;
        }

        // Get field definition
        const fieldDef = schemaType.getFields()[fieldName];
        if (!fieldDef) {
            return `    ${fieldName}: '${fieldName}'`;
        }

        // Get base type info
        const baseType = getBaseType(fieldDef.type);
        if (!baseType?.name) {
            return `    ${fieldName}: '${fieldName}'`;
        }

        // Compute field context path once (used by multiple handlers)
        const fieldContextPath = currentContextPath ? `${currentContextPath}.${fieldName}` : fieldName;
        const isListField = isFieldListType(fieldDef.type);

        // Find referenced type selection for object/interface types
        const referencedTypeSelection = this.findReferencedTypeSelection(baseType, fieldContextPath, allTypeSelections);

        // Dispatch to appropriate type handler
        if (referencedTypeSelection && (isObjectType(baseType) || isInterfaceType(baseType))) {
            return this.generateObjectFieldMock(
                fieldName,
                operationName,
                referencedTypeSelection,
                isListField,
                hasSingleRoot,
                rootFieldName,
                arrayIndex
            );
        }

        if (isEnumType(baseType)) {
            return this.generateEnumFieldMock(fieldName, baseType, isListField);
        }

        if (isUnionType(baseType)) {
            return this.generateUnionFieldMock(
                fieldName,
                baseType,
                fieldContextPath,
                operationName,
                allTypeSelections,
                isListField,
                hasSingleRoot,
                rootFieldName,
                arrayIndex
            );
        }

        if (isListField) {
            return this.generateScalarListFieldMock(fieldName, baseType.name);
        }

        if (baseType.name === 'ID' || fieldName === 'id') {
            return this.generateIdFieldMock(fieldName, currentContextPath, arrayIndex);
        }

        return this.generateScalarFieldMock(fieldName, baseType.name);
    }

    /**
     * Find the referenced type selection for a field, handling interface/union variants.
     */
    private findReferencedTypeSelection(
        baseType: any,
        fieldContextPath: string,
        allTypeSelections: TypeFieldSelection[]
    ): TypeFieldSelection | undefined {
        const referencedTypeName = baseType.name;

        // Check for exact match first
        let selection = allTypeSelections.find((s) => s.typeName === referencedTypeName && s.contextPath === fieldContextPath);

        // If no exact match, check for interface/union variants
        if (!selection && (isInterfaceType(baseType) || isUnionType(baseType))) {
            const variants = allTypeSelections
                .filter((s) => s.contextPath.startsWith(`${fieldContextPath}.`))
                .sort((a, b) => (a.inlineFragmentOrder || 0) - (b.inlineFragmentOrder || 0));

            if (variants.length > 0) {
                selection = variants[0];
            }
        }

        return selection;
    }

    /**
     * Generate mock value for object/interface type fields.
     */
    private generateObjectFieldMock(
        fieldName: string,
        operationName: string,
        referencedTypeSelection: TypeFieldSelection,
        isListField: boolean,
        hasSingleRoot: boolean,
        rootFieldName?: string,
        arrayIndex?: string
    ): string {
        const adjustedContextPath = this.adjustContextPath(referencedTypeSelection.contextPath, hasSingleRoot, rootFieldName);
        const functionName = buildFunctionName(operationName, adjustedContextPath);
        const call = formatMockFunctionCall(functionName, isListField, arrayIndex);
        return `    ${fieldName}: ${call}`;
    }

    /**
     * Generate mock value for enum type fields.
     */
    private generateEnumFieldMock(fieldName: string, baseType: any, isListField: boolean): string {
        const enumValues = baseType.getValues();
        if (enumValues.length === 0) {
            return `    ${fieldName}: null`;
        }

        const enumTypeName = this.convertName(baseType.name, {
            useTypesPrefix: false,
            useTypesSuffix: false
        });
        const enumValueName = enumValues[0].name;
        const enumReference = `Types.${enumTypeName}.${enumValueName}`;

        if (isListField) {
            return `    ${fieldName}: [${enumReference}, ${enumReference}]`;
        }
        return `    ${fieldName}: ${enumReference}`;
    }

    /**
     * Generate mock value for union type fields.
     */
    private generateUnionFieldMock(
        fieldName: string,
        baseType: any,
        fieldContextPath: string,
        operationName: string,
        allTypeSelections: TypeFieldSelection[],
        isListField: boolean,
        hasSingleRoot: boolean,
        rootFieldName?: string,
        arrayIndex?: string
    ): string {
        const unionTypes = baseType.getTypes();
        const unionMemberFunctions: string[] = [];

        for (const unionMemberType of unionTypes) {
            const unionMemberContextPath = `${fieldContextPath}.${unionMemberType.name}`;
            const unionMemberSelection = allTypeSelections.find(
                (s) => s.typeName === unionMemberType.name && s.contextPath === unionMemberContextPath
            );

            if (unionMemberSelection) {
                const adjustedPath = this.adjustContextPath(unionMemberContextPath, hasSingleRoot, rootFieldName);
                unionMemberFunctions.push(buildFunctionName(operationName, adjustedPath));
            }
        }

        if (unionMemberFunctions.length === 0) {
            return `    ${fieldName}: null`;
        }

        if (isListField) {
            const calls = unionMemberFunctions.map((fn, idx) =>
                arrayIndex ? `${fn}(undefined, \`\${${arrayIndex}}_${idx}\`)` : `${fn}(undefined, '${idx}')`
            );
            return `    ${fieldName}: [${calls.join(', ')}]`;
        }

        const call = formatMockFunctionCall(unionMemberFunctions[0], false, arrayIndex);
        return `    ${fieldName}: ${call}`;
    }

    /**
     * Generate mock value for scalar list fields.
     */
    private generateScalarListFieldMock(fieldName: string, typeName: string): string {
        const scalarListMock = SCALAR_LIST_MOCKS[typeName];
        if (scalarListMock) {
            return `    ${fieldName}: ${scalarListMock(fieldName)}`;
        }

        if (this._scalarMockValues[typeName]) {
            const customMockValue = getScalarMockValue(this._scalarMockValues[typeName], fieldName);
            return `    ${fieldName}: [${customMockValue}, ${customMockValue}]`;
        }

        return `    ${fieldName}: ['${fieldName}_0', '${fieldName}_1']`;
    }

    /**
     * Generate mock value for ID fields with unique identifiers.
     */
    private generateIdFieldMock(fieldName: string, currentContextPath: string, arrayIndex?: string): string {
        const contextPart = currentContextPath.replace(/\./g, '_');
        if (arrayIndex) {
            return `    ${fieldName}: \`${contextPart}_${fieldName}_\${${arrayIndex}}\``;
        }
        return `    ${fieldName}: \`${contextPart}_${fieldName}\${arrayIndex ? \`_\${arrayIndex}\` : ''}\``;
    }

    /**
     * Generate mock value for scalar fields (non-list, non-ID).
     */
    private generateScalarFieldMock(fieldName: string, typeName: string): string {
        // Check for custom scalars (skip built-in types)
        if (this._scalarMockValues[typeName] && !BUILT_IN_GRAPHQL_TYPES.includes(typeName as any)) {
            const customMockValue = getScalarMockValue(this._scalarMockValues[typeName], fieldName);
            return `    ${fieldName}: ${customMockValue}`;
        }

        // Default scalar values (handles all built-in types)
        const mockValue = getPrimitiveMockValue(typeName, fieldName);
        return `    ${fieldName}: ${mockValue}`;
    }

    /**
     * Create the mock function code
     */
    private createMockFunctionCode(
        functionName: string,
        interfaceName: string,
        mockFields: string,
        isRootArrayField: boolean,
        jsDoc = ''
    ): string {
        if (isRootArrayField) {
            return `${jsDoc}export const ${functionName} = (overrides?: Partial<${interfaceName}>[], length: number = 2): ${interfaceName}[] => {
  return Array.from({ length }, (_, i) => ({
${mockFields ? mockFields + ',' : ''}
    ...(overrides?.[i] || {}),
  }));
};`;
        } else {
            return `${jsDoc}export const ${functionName} = (overrides?: Partial<${interfaceName}>, arrayIndex = ''): ${interfaceName} => {
  return {
${mockFields ? mockFields + ',' : ''}
    ...overrides,
  };
};`;
        }
    }

    /**
     * Check if operation has single root field
     */
    private hasSingleRootField(operation: OperationDefinitionNode): {
        isSingle: boolean;
        rootFieldName?: string;
    } {
        const rootSelections = operation.selectionSet.selections.filter((selection) => selection.kind === Kind.FIELD);

        if (rootSelections.length === 1) {
            const rootField = rootSelections[0] as any;
            return { isSingle: true, rootFieldName: rootField.name.value };
        }

        return { isSingle: false };
    }

    /**
     * Find all type selections in an operation by traversing its selection set.
     *
     * @param operation - The GraphQL operation to analyze
     * @returns Array of type selections representing all types queried in the operation
     * @throws Error if the operation type is not supported by the schema
     */
    private findTypeSelections(operation: OperationDefinitionNode): TypeFieldSelection[] {
        const typeSelections = new Map<string, TypeFieldSelection>();

        const rootType = this.getRootTypeForOperation(operation);

        if (!rootType) {
            const operationName = operation.name?.value || 'unnamed';
            throw new Error(
                `Schema does not support ${operation.operation} operations (operation: "${operationName}"). ` +
                    `Ensure your GraphQL schema defines a ${operation.operation} type.`
            );
        }

        try {
            this.collectTypeSelectionsIteratively(operation.selectionSet.selections, typeSelections, rootType, '');
        } catch (error) {
            const operationName = operation.name?.value || 'unnamed';
            throw new Error(
                `Failed to analyze type selections for operation "${operationName}": ${error instanceof Error ? error.message : String(error)}`
            );
        }

        return Array.from(typeSelections.values());
    }

    /**
     * Recursively expand fragment spreads and collect fields.
     * Handles nested fragments and inline fragments within fragments.
     *
     * @param fragmentName - Name of the fragment to expand
     * @param selectedFields - Set to collect field names into
     * @param visitedFragments - Set to track visited fragments (prevents infinite loops)
     * @param targetTypeName - Optional type name to filter inline fragment fields
     * @throws Error if a referenced fragment is not found
     */
    private expandFragmentFields(
        fragmentName: string,
        selectedFields: Set<string>,
        visitedFragments: Set<string> = new Set(),
        targetTypeName?: string
    ): void {
        // Prevent infinite loops from circular fragment references
        if (visitedFragments.has(fragmentName)) {
            return;
        }

        visitedFragments.add(fragmentName);

        const fragment = this._allFragments.get(fragmentName);
        if (!fragment) {
            throw new Error(
                `Fragment "${fragmentName}" is referenced but not found. ` +
                    `Available fragments: ${Array.from(this._allFragments.keys()).join(', ') || 'none'}. ` +
                    `Ensure all fragments are included in the documents or externalFragments configuration.`
            );
        }

        if (!fragment.node?.selectionSet) {
            return;
        }

        for (const selection of fragment.node.selectionSet.selections) {
            if (selection.kind === Kind.FIELD) {
                selectedFields.add(selection.name.value);
            } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
                // Recursively expand nested fragment spreads
                this.expandFragmentFields(selection.name.value, selectedFields, visitedFragments, targetTypeName);
            } else if (selection.kind === Kind.INLINE_FRAGMENT && selection.selectionSet) {
                // Handle inline fragments within fragments
                // Only add fields if the inline fragment's type matches the target type (or if no type condition)
                const inlineFragmentTypeName = selection.typeCondition?.name.value;

                if (!inlineFragmentTypeName || !targetTypeName || inlineFragmentTypeName === targetTypeName) {
                    for (const inlineSelection of selection.selectionSet.selections) {
                        if (inlineSelection.kind === Kind.FIELD) {
                            selectedFields.add(inlineSelection.name.value);
                        } else if (inlineSelection.kind === Kind.FRAGMENT_SPREAD) {
                            // Recursively expand fragment spreads within inline fragments
                            this.expandFragmentFields(inlineSelection.name.value, selectedFields, visitedFragments, targetTypeName);
                        }
                    }
                }
            }
        }
    }

    /**
     * Recursively expand fragment spreads in a selection set.
     * Returns a flattened array of selections with all fragment spreads expanded.
     *
     * @param selections - The selections to expand (may contain fragment spreads)
     * @param visitedFragments - Set to track visited fragments (prevents infinite loops)
     * @returns Flattened array with fragment spreads replaced by their selections
     *
     * @example
     * ```typescript
     * // Input: [Field(id), FragmentSpread(UserFields), Field(name)]
     * // Output: [Field(id), Field(email), Field(avatar), Field(name)]
     * // (assuming UserFields fragment contains email and avatar fields)
     * ```
     */
    private expandSelectionSet(selections: readonly any[], visitedFragments: Set<string> = new Set()): any[] {
        const expandedSelections: any[] = [];

        for (const selection of selections) {
            if (selection.kind === Kind.FRAGMENT_SPREAD) {
                // Prevent infinite loops from circular fragment references
                if (visitedFragments.has(selection.name.value)) {
                    continue;
                }

                visitedFragments.add(selection.name.value);

                const fragment = this._allFragments.get(selection.name.value);
                if (fragment?.node?.selectionSet) {
                    // Recursively expand the fragment's selections
                    const fragmentSelections = this.expandSelectionSet(fragment.node.selectionSet.selections, visitedFragments);
                    expandedSelections.push(...fragmentSelections);
                }
            } else {
                // Keep field selections and inline fragments as-is
                expandedSelections.push(selection);
            }
        }

        return expandedSelections;
    }

    /**
     * Collect type selections iteratively using breadth-first traversal.
     *
     * This method processes the GraphQL selection set level by level to build a complete
     * map of all types and their selected fields. It uses an iterative approach with a queue
     * to avoid stack overflow on deeply nested queries.
     *
     * @param initialSelections - The selections to start processing
     * @param typeSelections - Map to accumulate type selections (mutated in place)
     * @param initialParentType - The GraphQL type these selections belong to
     * @param initialContextPath - The dot-separated path from operation root
     */
    private collectTypeSelectionsIteratively(
        initialSelections: readonly any[],
        typeSelections: Map<string, TypeFieldSelection>,
        initialParentType: any,
        initialContextPath = ''
    ) {
        let processingQueue: SelectionQueueItem[] = [
            {
                selections: initialSelections,
                parentType: initialParentType,
                contextPath: initialContextPath
            }
        ];

        while (processingQueue.length > 0) {
            processingQueue = processingQueue.flatMap((queueItem) => this.processSelectionQueueItem(queueItem, typeSelections));
        }
    }

    /**
     * Process a single queue item and return next level items.
     */
    private processSelectionQueueItem(
        queueItem: SelectionQueueItem,
        typeSelections: Map<string, TypeFieldSelection>
    ): SelectionQueueItem[] {
        const { selections, parentType, contextPath, interfaceFieldName } = queueItem;
        const nextLevelItems: SelectionQueueItem[] = [];

        for (const selection of selections) {
            const items = this.processSelection(selection, parentType, contextPath, interfaceFieldName, typeSelections);
            nextLevelItems.push(...items);
        }

        return nextLevelItems;
    }

    /**
     * Process a single selection and dispatch to the appropriate handler.
     */
    private processSelection(
        selection: any,
        parentType: any,
        contextPath: string,
        interfaceFieldName: string | undefined,
        typeSelections: Map<string, TypeFieldSelection>
    ): SelectionQueueItem[] {
        switch (selection.kind) {
            case Kind.FIELD:
                return this.handleFieldSelection(selection, parentType, contextPath, interfaceFieldName, typeSelections);
            case Kind.FRAGMENT_SPREAD:
                return this.handleFragmentSpread(selection, parentType, contextPath);
            case Kind.INLINE_FRAGMENT:
                return this.handleInlineFragment(selection, parentType, contextPath);
            default:
                return [];
        }
    }

    /**
     * Handle a field selection, dispatching to interface/object/union handlers as needed.
     */
    private handleFieldSelection(
        selection: any,
        parentType: any,
        contextPath: string,
        interfaceFieldName: string | undefined,
        typeSelections: Map<string, TypeFieldSelection>
    ): SelectionQueueItem[] {
        if (!isObjectType(parentType)) return [];

        const fieldName = selection.name.value;
        const fieldDef = parentType.getFields()[fieldName];
        if (!fieldDef) return [];

        const fieldType = getNamedType(fieldDef.type);
        const newContextPath = contextPath ? `${contextPath}.${fieldName}` : fieldName;

        if (isInterfaceType(fieldType)) {
            return this.handleInterfaceFieldSelection(selection, fieldName, newContextPath, typeSelections);
        } else if (isObjectType(fieldType)) {
            return this.handleObjectFieldSelection(selection, fieldType, newContextPath, interfaceFieldName, typeSelections);
        } else if (isUnionType(fieldType)) {
            return this.handleUnionFieldSelection(selection, fieldType, fieldName, newContextPath, typeSelections);
        }

        return [];
    }

    /**
     * Handle interface type field selections.
     * Creates separate type selections for each concrete implementing type.
     */
    private handleInterfaceFieldSelection(
        selection: any,
        fieldName: string,
        newContextPath: string,
        typeSelections: Map<string, TypeFieldSelection>
    ): SelectionQueueItem[] {
        if (!selection.selectionSet) return [];

        const nextLevelItems: SelectionQueueItem[] = [];

        // Collect all selections including those from fragment spreads
        const allInterfaceSelections = this.expandFragmentSpreadsInSelections(selection.selectionSet.selections);

        // Get concrete implementing types from inline fragments
        const inlineFragments = allInterfaceSelections.filter((sel) => sel.kind === Kind.INLINE_FRAGMENT && sel.typeCondition);

        // Collect common fields (those outside inline fragments)
        const { commonFields, commonFieldSelections } = this.collectCommonFields(allInterfaceSelections);

        // Expand common field selections for traversal
        const expandedCommonSelections = this.expandSelectionSet(commonFieldSelections);

        // Create a type selection for each concrete type from inline fragments
        inlineFragments.forEach((inlineFragment, index) => {
            const concreteTypeName = inlineFragment.typeCondition.name.value;
            const concreteType = this._schema.getType(concreteTypeName);
            const interfaceContextPath = `${newContextPath}.${concreteTypeName}`;

            let typeSelection = typeSelections.get(interfaceContextPath);
            if (!typeSelection) {
                typeSelection = {
                    typeName: concreteTypeName,
                    contextPath: interfaceContextPath,
                    selectedFields: new Set(commonFields),
                    concreteTypeName,
                    inlineFragmentOrder: index
                };
                typeSelections.set(interfaceContextPath, typeSelection);
            }

            // Add fields specific to this concrete type
            if (inlineFragment.selectionSet) {
                this.addFieldsFromSelectionSet(inlineFragment.selectionSet.selections, typeSelection.selectedFields, concreteTypeName);

                const expandedInterfaceSelections = this.expandSelectionSet(inlineFragment.selectionSet.selections);

                nextLevelItems.push({
                    selections: [...expandedCommonSelections, ...expandedInterfaceSelections],
                    parentType: concreteType,
                    contextPath: interfaceContextPath,
                    interfaceFieldName: fieldName
                });
            }
        });

        return nextLevelItems;
    }

    /**
     * Handle object type field selections.
     */
    private handleObjectFieldSelection(
        selection: any,
        fieldType: any,
        newContextPath: string,
        interfaceFieldName: string | undefined,
        typeSelections: Map<string, TypeFieldSelection>
    ): SelectionQueueItem[] {
        let typeSelection = typeSelections.get(newContextPath);
        if (!typeSelection) {
            typeSelection = {
                typeName: fieldType.name,
                contextPath: newContextPath,
                selectedFields: new Set(),
                interfaceFieldName
            };
            typeSelections.set(newContextPath, typeSelection);
        }

        if (!selection.selectionSet) return [];

        for (const subSelection of selection.selectionSet.selections) {
            if (subSelection.kind === Kind.FIELD) {
                typeSelection.selectedFields.add(subSelection.name.value);
            } else if (subSelection.kind === Kind.FRAGMENT_SPREAD) {
                this.expandFragmentFields(subSelection.name.value, typeSelection.selectedFields, new Set(), fieldType.name);
            } else if (subSelection.kind === Kind.INLINE_FRAGMENT) {
                this.handleInlineFragmentForObjectType(subSelection, fieldType.name, typeSelection.selectedFields);
            }
        }

        const expandedSelections = this.expandSelectionSet(selection.selectionSet.selections);

        return [
            {
                selections: expandedSelections,
                parentType: fieldType,
                contextPath: newContextPath
            }
        ];
    }

    /**
     * Handle inline fragments within object type field selections.
     */
    private handleInlineFragmentForObjectType(subSelection: any, fieldTypeName: string, selectedFields: Set<string>): void {
        const inlineFragmentTypeName = subSelection.typeCondition?.name.value;

        // If no type condition, it applies to the current type
        // If there is a type condition, check if it matches the current type
        if (!inlineFragmentTypeName || inlineFragmentTypeName === fieldTypeName) {
            if (subSelection.selectionSet) {
                this.addFieldsFromSelectionSet(subSelection.selectionSet.selections, selectedFields, fieldTypeName);
            }
        }
    }

    /**
     * Handle union type field selections.
     * Creates separate type selections for each union member type.
     */
    private handleUnionFieldSelection(
        selection: any,
        fieldType: any,
        fieldName: string,
        newContextPath: string,
        typeSelections: Map<string, TypeFieldSelection>
    ): SelectionQueueItem[] {
        if (!selection.selectionSet) return [];

        const nextLevelItems: SelectionQueueItem[] = [];
        const unionTypes = fieldType.getTypes();

        // Collect all selections including those from fragment spreads
        const allUnionSelections = this.expandFragmentSpreadsInSelections(selection.selectionSet.selections);

        // Process inline fragments for each union member type
        for (const unionMemberType of unionTypes) {
            const unionMemberContextPath = `${newContextPath}.${unionMemberType.name}`;

            for (const subSelection of allUnionSelections) {
                if (subSelection.kind === Kind.INLINE_FRAGMENT && subSelection.typeCondition?.name.value === unionMemberType.name) {
                    let typeSelection = typeSelections.get(unionMemberContextPath);
                    if (!typeSelection) {
                        typeSelection = {
                            typeName: unionMemberType.name,
                            contextPath: unionMemberContextPath,
                            selectedFields: new Set(),
                            interfaceFieldName: fieldName
                        };
                        typeSelections.set(unionMemberContextPath, typeSelection);
                    }

                    this.addFieldsFromSelectionSet(
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        subSelection.selectionSet!.selections,
                        typeSelection.selectedFields,
                        unionMemberType.name
                    );

                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const expandedUnionSelections = this.expandSelectionSet(subSelection.selectionSet!.selections);

                    nextLevelItems.push({
                        selections: expandedUnionSelections,
                        parentType: unionMemberType,
                        contextPath: unionMemberContextPath,
                        interfaceFieldName: fieldName
                    });
                }
            }
        }

        return nextLevelItems;
    }

    /**
     * Handle fragment spread at the top level of selection processing.
     */
    private handleFragmentSpread(selection: any, parentType: any, contextPath: string): SelectionQueueItem[] {
        const fragment = this._allFragments.get(selection.name.value);
        if (!fragment?.node?.selectionSet) return [];

        const fragmentTypeName = fragment.onType;
        const fragmentType = this._schema.getType(fragmentTypeName);

        return [
            {
                selections: fragment.node.selectionSet.selections,
                parentType: fragmentType || parentType,
                contextPath
            }
        ];
    }

    /**
     * Handle inline fragment at the top level of selection processing.
     */
    private handleInlineFragment(selection: any, parentType: any, contextPath: string): SelectionQueueItem[] {
        if (!selection.selectionSet) return [];

        const inlineFragmentType = selection.typeCondition ? this._schema.getType(selection.typeCondition.name.value) : parentType;

        return [
            {
                selections: selection.selectionSet.selections,
                parentType: inlineFragmentType || parentType,
                contextPath
            }
        ];
    }

    /**
     * Expand fragment spreads in a list of selections, returning all selections with fragments inlined.
     */
    private expandFragmentSpreadsInSelections(selections: readonly any[]): any[] {
        const result: any[] = [];

        for (const subSelection of selections) {
            if (subSelection.kind === Kind.FRAGMENT_SPREAD) {
                const fragment = this._allFragments.get(subSelection.name.value);
                if (fragment?.node?.selectionSet) {
                    result.push(...fragment.node.selectionSet.selections);
                }
            } else {
                result.push(subSelection);
            }
        }

        return result;
    }

    /**
     * Collect common fields (fields outside inline fragments) from a selection set.
     */
    private collectCommonFields(allSelections: any[]): { commonFields: Set<string>; commonFieldSelections: any[] } {
        const commonFields = new Set<string>();
        const commonFieldSelections: any[] = [];

        for (const subSelection of allSelections) {
            if (subSelection.kind === Kind.FIELD) {
                commonFields.add(subSelection.name.value);
                commonFieldSelections.push(subSelection);
            } else if (subSelection.kind === Kind.FRAGMENT_SPREAD) {
                this.expandFragmentFields(subSelection.name.value, commonFields, new Set(), undefined);
            }
        }

        return { commonFields, commonFieldSelections };
    }

    /**
     * Add fields from a selection set to a Set, expanding fragment spreads.
     */
    private addFieldsFromSelectionSet(selections: readonly any[], selectedFields: Set<string>, targetTypeName: string): void {
        for (const sel of selections) {
            if (sel.kind === Kind.FIELD) {
                selectedFields.add(sel.name.value);
            } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
                this.expandFragmentFields(sel.name.value, selectedFields, new Set(), targetTypeName);
            }
        }
    }

    /**
     * Build a typescript-operations compatible type name based on operation context.
     *
     * Mimics the naming logic from SelectionSetToObject.buildParentFieldName and buildFragmentTypeName
     * in @graphql-codegen/visitor-plugin-common.
     *
     * For operation types (Query/Mutation/Subscription), we skip adding the type name in the parent field.
     *
     * Pattern: ${operationName}${operationType}_${fieldPath}_${typeName}
     *
     * @param operation - The GraphQL operation definition
     * @param operationName - Converted operation name
     * @param operationType - Type of operation ('query', 'mutation', 'subscription')
     * @param contextPath - Dot-separated path to this type (e.g., 'messages.author')
     * @param terminalTypeName - The final GraphQL type name
     * @returns TypeScript-operations style type name
     *
     * @example
     * ```typescript
     * // Operation "Messages" + Query + "messages" field + "Message" type
     * buildTypeScriptOperationsTypeName(...)
     * // Returns: "MessagesQuery_messages_Message"
     *
     * // Operation "Messages" + Query + "messages.author" path + "Author" type
     * buildTypeScriptOperationsTypeName(...)
     * // Returns: "MessagesQuery_messages_Message_author_Author"
     *
     * // For union types: "messages.result.SuccessResult"
     * buildTypeScriptOperationsTypeName(...)
     * // Returns: "MessagesQuery_messages_Message_result_SuccessResult"
     * ```
     */
    private buildTypeScriptOperationsTypeName(
        operation: OperationDefinitionNode,
        operationName: string,
        operationType: string,
        contextPath: string,
        terminalTypeName: string
    ): string {
        // Start with operation name + operation type (e.g., "MessagesQuery")
        const operationTypeSuffix = operationType.charAt(0).toUpperCase() + operationType.slice(1);
        let result = `${operationName}${operationTypeSuffix}`;

        // Process context path: traverse schema to get actual type names at each level
        // Pattern: _fieldName_TypeName_nestedField_NestedType...
        if (contextPath) {
            const parts = contextPath.split('.');

            // Get the root type for the operation
            const rootType = this.getRootTypeForOperation(operation);

            if (!rootType) {
                // Fallback: just use the terminal type name
                return `${result}_${contextPath.split('.').join('_')}_${terminalTypeName}`;
            }

            let currentType: any = rootType;

            // Traverse the path to build the full type name
            for (let i = 0; i < parts.length; i++) {
                const fieldName = parts[i];

                // Add field name
                result += `_${fieldName}`;

                // Get the field definition to determine its type
                if (isObjectType(currentType)) {
                    const fieldDef = currentType.getFields()[fieldName];
                    if (fieldDef) {
                        const fieldType = getNamedType(fieldDef.type);

                        // Check if fieldType is valid
                        if (!fieldType || !fieldType.name) {
                            result += `_${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
                            continue;
                        }

                        // For union types, we need to check if the next part is a union member type
                        if (isUnionType(fieldType) && i + 1 < parts.length) {
                            // The next part should be the union member type name
                            const nextPart = parts[i + 1];
                            const unionTypes = fieldType.getTypes();
                            const unionMemberType = unionTypes.find((t) => t && t.name === nextPart);

                            if (unionMemberType) {
                                // Skip adding the union type name, go directly to the member type
                                i++; // Skip the next part (union member type name)
                                result += `_${nextPart}`;
                                currentType = unionMemberType;
                            } else {
                                // Not a union member, add the field type name
                                result += `_${fieldType.name}`;
                                currentType = fieldType;
                            }
                        } else if (isInterfaceType(fieldType) && i + 1 < parts.length) {
                            // For interface types, check if the next part is a concrete implementing type
                            const nextPart = parts[i + 1];
                            const implementingType = this._schema.getType(nextPart);

                            if (implementingType && isObjectType(implementingType)) {
                                // Skip adding the interface type name, go directly to the implementing type
                                i++; // Skip the next part (implementing type name)
                                result += `_${nextPart}`;
                                currentType = implementingType;
                            } else {
                                // Not an implementing type, add the interface type name
                                result += `_${fieldType.name}`;
                                currentType = fieldType;
                            }
                        } else {
                            // Add the type name for this field
                            result += `_${fieldType.name}`;
                            currentType = fieldType;
                        }
                    } else {
                        // Field not found, use capitalized field name as fallback
                        result += `_${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
                    }
                } else {
                    // Not an object type, use capitalized field name as fallback
                    result += `_${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
                }
            }
        }

        return result;
    }

    /**
     * Generate type aliases that map clean names to typescript-operations names.
     *
     * This method creates type aliases that make it easier to reference the verbose type names
     * generated by the typescript-operations plugin. It also handles deduplication of nested
     * types across operations - if the same nested type with identical field selections appears
     * in multiple operations, all aliases will reference the first occurrence.
     *
     * @returns Array of type alias declaration strings
     *
     * @example
     * ```typescript
     * // Input: Query Messages { messages { id, author { name } } }
     * // Output:
     * // export type Query_Messages = MessagesQuery_messages_Message;
     * // export type Query_Messages_Author = MessagesQuery_messages_Message_author_Author;
     *
     * // With deduplication:
     * // If Author.address appears in multiple queries with same fields,
     * // all type aliases will reference the first occurrence:
     * // export type Query_Messages_Author_Address = MessagesQuery_messages_Message_author_Author_address_Address;
     * // export type Query_Posts_Author_Address = MessagesQuery_messages_Message_author_Author_address_Address; // same!
     * ```
     */
    generateTypeAliases(): string[] {
        const operations = this.extractOperations();

        // Track the FIRST occurrence of each ParentTypeName.fieldName combination WITH identical field selections
        // TypeScript-operations deduplicates nested types only when they have the same field selections
        // Key: "ParentTypeName.fieldName:field1,field2,..." (e.g., "Author.address:street,city,zip")
        // Value: { operation, operationName, operationType, contextPath, typeName }
        const globalNestedTypeFirstOccurrence = new Map<
            string,
            {
                operation: OperationDefinitionNode;
                operationName: string;
                operationType: string;
                contextPath: string;
                typeName: string;
            }
        >();

        // First pass: collect all type selections and track first occurrences
        const allOperationData: Array<{
            operation: OperationDefinitionNode;
            operationName: string;
            operationType: string;
            typeSelections: TypeFieldSelection[];
            hasSingleRoot: boolean;
            rootFieldName?: string;
        }> = [];

        for (const operation of operations) {
            const operationName = this.convertName(operation, {
                useTypesPrefix: false,
                useTypesSuffix: false
            });
            const operationType = operation.operation;
            const typeSelections = this.findTypeSelections(operation);
            const { isSingle: hasSingleRoot, rootFieldName } = this.hasSingleRootField(operation);

            allOperationData.push({
                operation,
                operationName,
                operationType,
                typeSelections,
                hasSingleRoot,
                rootFieldName
            });

            // Track first occurrence of each nested type across all operations
            // Only deduplicate types with identical field selections
            for (const selection of typeSelections) {
                const pathParts = selection.contextPath.split('.');
                if (pathParts.length >= 2) {
                    const currentField = pathParts[pathParts.length - 1];
                    const parentPath = pathParts.slice(0, -1).join('.');
                    const parentSelection = typeSelections.find((s) => s.contextPath === parentPath);

                    if (parentSelection) {
                        // Include field selections in the key to ensure we only deduplicate identical types
                        const sortedFields = Array.from(selection.selectedFields).sort().join(',');

                        // For nested fields under interface/union variants, use the interface field name
                        // to ensure all variants share the same deduplication key
                        let deduplicationKey: string;
                        if (selection.interfaceFieldName) {
                            // This is a nested field under an interface/union variant
                            // Use the interface field name instead of the concrete type name
                            deduplicationKey = `${selection.interfaceFieldName}.${currentField}:${sortedFields}`;
                        } else {
                            // Regular nested type
                            deduplicationKey = `${parentSelection.typeName}.${currentField}:${sortedFields}`;
                        }

                        if (!globalNestedTypeFirstOccurrence.has(deduplicationKey)) {
                            globalNestedTypeFirstOccurrence.set(deduplicationKey, {
                                operation,
                                operationName,
                                operationType,
                                contextPath: selection.contextPath,
                                typeName: selection.typeName
                            });
                        }
                    }
                }
            }
        }

        // Second pass: generate type aliases
        return allOperationData.flatMap(({ operation, operationName, operationType, typeSelections, hasSingleRoot, rootFieldName }) => {
            return typeSelections.map((typeSelection) => {
                const adjustedContextPath = this.adjustContextPath(typeSelection.contextPath, hasSingleRoot, rootFieldName);

                // Build clean name (current mock function pattern) - uses adjusted path
                const basePrefix = operationType.charAt(0).toUpperCase() + operationType.slice(1);
                const cleanName = `${basePrefix}_${operationName}${contextToPascalCase(adjustedContextPath)}`;

                // Check if this is a nested type that typescript-operations deduplicates
                // Only deduplicate if the same parent type + field combination WITH identical field selections was seen
                const pathParts = typeSelection.contextPath.split('.');
                if (pathParts.length >= 2) {
                    const currentField = pathParts[pathParts.length - 1];
                    const parentPath = pathParts.slice(0, -1).join('.');
                    const parentSelection = typeSelections.find((s) => s.contextPath === parentPath);

                    if (parentSelection) {
                        // Include field selections in the key to match first pass logic
                        const sortedFields = Array.from(typeSelection.selectedFields).sort().join(',');

                        // Use same deduplication key logic as first pass
                        let deduplicationKey: string;
                        if (typeSelection.interfaceFieldName) {
                            // This is a nested field under an interface/union variant
                            deduplicationKey = `${typeSelection.interfaceFieldName}.${currentField}:${sortedFields}`;
                        } else {
                            // Regular nested type
                            deduplicationKey = `${parentSelection.typeName}.${currentField}:${sortedFields}`;
                        }

                        const canonicalOccurrence = globalNestedTypeFirstOccurrence.get(deduplicationKey);

                        if (
                            canonicalOccurrence &&
                            (canonicalOccurrence.operation !== operation || canonicalOccurrence.contextPath !== typeSelection.contextPath)
                        ) {
                            // This nested type was seen in another operation (or earlier in this one) - use the canonical occurrence
                            const tsOperationsName = this.buildTypeScriptOperationsTypeName(
                                canonicalOccurrence.operation,
                                canonicalOccurrence.operationName,
                                canonicalOccurrence.operationType,
                                canonicalOccurrence.contextPath,
                                canonicalOccurrence.typeName
                            );

                            return `export type ${cleanName} = ${tsOperationsName};`;
                        }
                    }
                }

                // Not a deduplicated nested type - build the typescript-operations name directly
                const tsOperationsName = this.buildTypeScriptOperationsTypeName(
                    operation,
                    operationName,
                    operationType,
                    typeSelection.contextPath,
                    typeSelection.typeName
                );

                // Generate type alias
                return `export type ${cleanName} = ${tsOperationsName};`;
            });
        });
    }
}

/**
 * GraphQL Code Generator plugin that generates mock functions and type aliases for operations.
 *
 * This plugin analyzes GraphQL operations and generates TypeScript code to help with testing.
 * It has two modes controlled by the `generateTypeAliasesOnly` configuration option:
 *
 * **Mock Functions Mode** (default):
 * Generates factory functions that create mock data matching your GraphQL operations.
 * Each function returns properly typed mock objects with sensible defaults.
 *
 * **Type Aliases Mode**:
 * Generates clean type aliases that map to the verbose names from typescript-operations plugin.
 * Makes it easier to reference types like `Query_Messages` instead of `MessagesQuery_messages_Message`.
 *
 * @param schema - The GraphQL schema
 * @param documents - GraphQL documents containing operations and fragments
 * @param config - Plugin configuration options
 * @param info - Additional context (e.g., output file path)
 * @returns Generated TypeScript code as a string
 *
 * @example
 * ```typescript
 * // graphql.config.ts
 * {
 *   generates: {
 *     'src/graphql/generated/': {
 *       preset: 'near-operation-file',
 *       plugins: [
 *         'typescript-operations',
 *         'mock-operations-plugin'
 *       ],
 *       config: {
 *         typePrefix: 'QueryTypes.',
 *         scalars: {
 *           LocalDate: 'new Date()',
 *           TimezoneDate: 'new Date()'
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Usage in tests:
 * import { fake_Messages, fake_Messages_author } from './messages.mocks';
 *
 * const mockMessages = fake_Messages();
 * // Returns array of 2 Message objects with all fields filled
 *
 * const customMessage = fake_Messages_author('', { name: 'Custom Author' });
 * // Returns Author object with name overridden
 * ```
 */
export const plugin: PluginFunction<OperationMocksPluginConfig> = (
    schema: GraphQLSchema,
    documents: Types.DocumentFile[],
    config: OperationMocksPluginConfig,
    info?: any
): string => {
    // Check if documents contain any operations (not just fragments)
    const hasOperations = documents.some((doc) =>
        doc.document?.definitions.some((def) => def.kind === Kind.OPERATION_DEFINITION && def.name?.value)
    );

    // Skip generation if there are no operations (only fragments)
    if (!hasOperations) {
        return '';
    }

    // Extract fragments from documents AND from config.externalFragments (near-operation-file preset)
    const allFragments: LoadedFragment[] = [
        // Fragments from current documents
        ...documents
            .flatMap((doc) => doc.document?.definitions || [])
            .filter((def): def is FragmentDefinitionNode => def.kind === Kind.FRAGMENT_DEFINITION)
            .map((fragmentDef) => ({
                name: fragmentDef.name.value,
                onType: fragmentDef.typeCondition.name.value,
                node: fragmentDef,
                isExternal: false,
                importFrom: null
            })),
        // External fragments from preset (near-operation-file)
        ...(config.externalFragments || [])
    ];

    const visitor = new OperationMocksVisitor(schema, allFragments, config, documents);

    try {
        // Check if we should generate type aliases instead of mock functions
        if (config.generateTypeAliasesOnly) {
            // Generate type aliases only
            const typeAliases = visitor.generateTypeAliases();

            // Add debug comment
            const debug = `// Debug: Generated ${typeAliases.length} type aliases`;

            return [debug, ...typeAliases].join('\n\n');
        }

        // Generate mock functions (default behavior)
        const mockFunctions = visitor.generateMockFunctions();

        // Generate import statement based on output file path
        let importStatement = ``;

        if (info?.outputFile) {
            // Extract filename without extension from the output file path
            const outputPath = info.outputFile;
            const pathParts = outputPath.split('/');
            const filename = pathParts[pathParts.length - 1];
            const filenameWithoutExtension = filename.split('.').slice(0, -1).join('.').replace('.mocks', '');

            // Generate the import path
            importStatement = `import type * as QueryTypes from './${filenameWithoutExtension}.types';`;
        }

        return [importStatement, '', ...mockFunctions].join('\n\n');
    } catch (error) {
        throw new Error(`GraphQL Mock Operations Plugin failed: ${error instanceof Error ? error.message : String(error)}`);
    }
};
