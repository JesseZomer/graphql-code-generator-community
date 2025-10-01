import {
  FieldNode,
  GraphQLSchema,
  isNonNullType,
  isObjectType,
  Kind,
  OperationDefinitionNode,
} from 'graphql';
import { PluginFunction, Types } from '@graphql-codegen/plugin-helpers';

/**
 * Configuration options for the TypeScript Operation Mocks plugin
 */
export interface OperationMocksPluginConfig {
  /**
   * @description Generate mock functions using the fake${QueryName}${SchemaType} naming pattern.
   * These functions return objects with only the fields selected in your GraphQL operations.
   * @default true
   * @example fakeGetMessagesMessage(), fakeGetMessagesAuthor()
   */
  generateMocks?: boolean;

  /**
   * @description Generate TypeScript interfaces for selected fields only.
   * Creates interfaces like GetMessages_Message with only the fields you actually query.
   * Similar to extractAllFieldsToTypes in typescript-operations plugin.
   * @default false
   * @example GetMessages_Message { id: string; author: GetMessages_Author; }
   */
  generateQueryTypes?: boolean;

  /**
   * @description Path to import schema types from. Auto-handled by near-operation-file preset.
   * @default '../types'
   */
  typesFile?: string;
}

// Interface to track what fields are selected for each type
interface TypeFieldSelection {
  typeName: string;
  selectedFields: Set<string>;
}

/**
 * GraphQL Code Generator plugin that creates mock functions for operations.
 *
 * WHAT IT DOES:
 * - Analyzes your GraphQL operations (queries/mutations/subscriptions)
 * - Generates mock functions with the pattern: a{OperationName}{TypeName}
 * - Only includes fields that are actually selected in your operations
 * - Optionally generates TypeScript interfaces for field-specific types
 *
 * EXAMPLE:
 * For a query "GetMessages" selecting { id, author { name } }:
 * - Generates: fakeGetMessagesMessage() → { id: 'id', author: fakeGetMessagesAuthor() }
 * - Generates: fakeGetMessagesAuthor() → { name: 'name' }
 */
export const plugin: PluginFunction<OperationMocksPluginConfig> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: OperationMocksPluginConfig,
): string => {
  // Apply defaults to configuration
  const shouldGenerateMocks = config.generateMocks !== false; // default: true
  const shouldGenerateTypes = config.generateQueryTypes === true; // default: false

  // Generate only TypeScript interfaces when mocks are disabled
  if (shouldGenerateTypes && !shouldGenerateMocks) {
    return generateQueryTypes_impl(schema, documents);
  }

  // Generate mock functions (with optional generated type usage)
  return generateOperationMocks(schema, documents, config.typesFile, shouldGenerateTypes);
}; /**
 * Unwraps GraphQL type wrappers (NonNull, List) to get the base type.
 *
 * EXAMPLE: String! → String, [User!]! → User
 */
function getBaseType(type: any): any {
  return type.ofType ? getBaseType(type.ofType) : type;
}

/**
 * Generates a mock value for a specific field based on its GraphQL type.
 *
 * LOGIC:
 * - If field is an object type with a mock function → call that function
 * - If field is a primitive type → return appropriate mock value
 * - Fallback to string for unknown types
 */
function generateMockFieldValue(
  schema: GraphQLSchema,
  typeName: string,
  fieldName: string,
  operationName: string,
  allTypeSelections: TypeFieldSelection[],
): string {
  const schemaType = schema.getType(typeName);

  // Safety check: ensure we have a valid object type
  if (!schemaType || !isObjectType(schemaType)) {
    return `    ${fieldName}: '${fieldName}'`; // fallback
  }

  const fieldDef = schemaType.getFields()[fieldName];
  if (!fieldDef) {
    return `    ${fieldName}: '${fieldName}'`; // fallback
  }

  const baseType = getBaseType(fieldDef.type);
  const referencedTypeName = baseType.name;

  // Check if this field references another object type that we have a mock for
  const hasReferencedMockFunction = allTypeSelections.some(
    selection => selection.typeName === referencedTypeName,
  );

  if (hasReferencedMockFunction && isObjectType(baseType)) {
    // Call the mock function for the referenced type
    return `    ${fieldName}: fake${operationName}${referencedTypeName}()`;
  }

  // Generate appropriate primitive mock values
  const mockValue = getPrimitiveMockValue(baseType.name, fieldName);
  return `    ${fieldName}: ${mockValue}`;
}

/**
 * Returns appropriate mock values for GraphQL scalar types.
 */
function getPrimitiveMockValue(typeName: string, fieldName: string): string {
  switch (typeName) {
    case 'String':
      return `'${fieldName}'`;
    case 'Int':
    case 'Float':
      return '1';
    case 'Boolean':
      return 'true';
    case 'ID':
      return "'a'";
    default:
      return "'a'"; // fallback for custom scalars
  }
}

/**
 * Generates mock functions for GraphQL operations.
 *
 * PROCESS:
 * 1. Add necessary imports (schema types and/or generated query types)
 * 2. For each operation, find all selected types and fields
 * 3. Generate a mock function for each type with realistic mock data
 * 4. Handle nested objects by calling other mock functions
 */
function generateOperationMocks(
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  typesFile?: string,
  useGeneratedTypes?: boolean,
): string {
  const mockFunctions: string[] = [];

  // Import schema types when using custom types file (not preset)
  if (typesFile) {
    mockFunctions.push(`import * as Types from '${typesFile}';`, '');
  }

  // Import generated query-specific types when enabled
  if (useGeneratedTypes) {
    mockFunctions.push(`import type * as QueryTypes from '../query-types';`, '');
  }

  documents
    .filter(doc => doc.document)
    .forEach(doc => {
      const ast = doc.document!;

      ast.definitions
        .filter(
          (def): def is OperationDefinitionNode =>
            def.kind === Kind.OPERATION_DEFINITION && !!def.name?.value,
        )
        .forEach(operation => {
          const operationName = operation.name!.value;
          const typeSelections = findTypeSelections(schema, operation);

          // Create a mock function for each type and its selected fields
          typeSelections.forEach(typeSelection => {
            const functionName = `fake${operationName}${typeSelection.typeName}`;

            // Use generated interface name if useGeneratedTypes is true
            const interfaceName = useGeneratedTypes
              ? `QueryTypes.${operationName}_${typeSelection.typeName}`
              : typeSelection.typeName;

            // Generate mock data for each selected field with appropriate types
            const mockFields = Array.from(typeSelection.selectedFields)
              .map(field =>
                generateMockFieldValue(
                  schema,
                  typeSelection.typeName,
                  field,
                  operationName,
                  typeSelections,
                ),
              )
              .join(',\n');

            const mockFunction = `export const ${functionName} = (overrides?: Partial<${interfaceName}>): ${interfaceName} => {
  return {
${mockFields},
    ...overrides,
  };
};`;

            mockFunctions.push(mockFunction);
          });
        });
    });

  return mockFunctions.join('\n');
}

/**
 * Generates TypeScript interfaces for operation-specific field selections.
 *
 * PURPOSE:
 * Instead of using full schema types, create interfaces with only the fields
 * that are actually selected in your GraphQL operations.
 *
 * EXAMPLE:
 * Query: { user { id, name, profile { bio } } }
 * Generates: GetUser_User { id: string; name: string; profile: GetUser_Profile; }
 *            GetUser_Profile { bio: string; }
 *
 * PROCESS:
 * 1. First pass: Collect all type selections across all operations
 * 2. Second pass: Generate interfaces with proper cross-references
 */
function generateQueryTypes_impl(schema: GraphQLSchema, documents: Types.DocumentFile[]): string {
  const typeInterfaces: string[] = [];
  const generatedTypes = new Set<string>(); // Track generated interfaces to avoid duplicates

  // FIRST PASS: Map all operation types to their selected fields
  const allTypeSelections = new Map<string, Set<string>>();

  documents
    .filter(doc => doc.document)
    .forEach(doc => {
      const ast = doc.document!;

      ast.definitions
        .filter(
          (def): def is OperationDefinitionNode =>
            def.kind === Kind.OPERATION_DEFINITION && !!def.name?.value,
        )
        .forEach(operation => {
          const operationName = operation.name!.value;
          const typeSelections = findTypeSelections(schema, operation);

          typeSelections.forEach(typeSelection => {
            const interfaceName = `${operationName}_${typeSelection.typeName}`;
            allTypeSelections.set(interfaceName, typeSelection.selectedFields);
          });
        });
    });

  // Second pass: generate interfaces with proper type references
  documents
    .filter(doc => doc.document)
    .forEach(doc => {
      const ast = doc.document!;

      ast.definitions
        .filter(
          (def): def is OperationDefinitionNode =>
            def.kind === Kind.OPERATION_DEFINITION && !!def.name?.value,
        )
        .forEach(operation => {
          const operationName = operation.name!.value;
          const typeSelections = findTypeSelections(schema, operation);

          // Create TypeScript interfaces for each type with selected fields
          typeSelections.forEach(typeSelection => {
            const interfaceName = `${operationName}_${typeSelection.typeName}`;

            if (!generatedTypes.has(interfaceName)) {
              generatedTypes.add(interfaceName);

              // Generate interface with only selected fields
              const interfaceFields = Array.from(typeSelection.selectedFields)
                .map(field => {
                  // Get the field type from the schema
                  const schemaType = schema.getType(typeSelection.typeName);
                  if (schemaType && isObjectType(schemaType)) {
                    const fieldDef = schemaType.getFields()[field];
                    if (fieldDef) {
                      const baseType = getBaseType(fieldDef.type);
                      const isNullable = !isNonNullType(fieldDef.type); // Check if field is nullable

                      let fieldType = 'string'; // default fallback

                      if (baseType.name === 'String') fieldType = 'string';
                      else if (baseType.name === 'Int' || baseType.name === 'Float')
                        fieldType = 'number';
                      else if (baseType.name === 'Boolean') fieldType = 'boolean';
                      else if (baseType.name === 'ID') fieldType = 'string';
                      else {
                        // Check if this is an object type that we're generating an interface for
                        const referencedInterfaceName = `${operationName}_${baseType.name}`;
                        if (allTypeSelections.has(referencedInterfaceName)) {
                          fieldType = referencedInterfaceName;
                        } else {
                          fieldType = baseType.name; // Use the schema type name as fallback
                        }
                      }

                      // Add null union type for nullable fields
                      if (isNullable) {
                        fieldType = `${fieldType} | null`;
                      }

                      return `  ${field}: ${fieldType};`;
                    }
                  }
                  return `  ${field}: any;`; // fallback
                })
                .join('\n');

              const interfaceDeclaration = `export interface ${interfaceName} {
${interfaceFields}
}`;

              typeInterfaces.push(interfaceDeclaration);
            }
          });
        });
    });

  return typeInterfaces.join('\n\n');
}

/**
 * Analyzes a GraphQL operation to find all selected types and their fields.
 *
 * WHAT IT DOES:
 * - Traverses the operation's selection set (query/mutation/subscription)
 * - Identifies which GraphQL object types are referenced
 * - Tracks which specific fields are selected for each type
 * - Uses iterative approach (no recursion) for better performance
 *
 * EXAMPLE INPUT: query GetUser { user { id, profile { bio } } }
 * EXAMPLE OUTPUT: [
 *   { typeName: 'User', selectedFields: Set(['id', 'profile']) },
 *   { typeName: 'Profile', selectedFields: Set(['bio']) }
 * ]
 */
function findTypeSelections(
  schema: GraphQLSchema,
  operation: OperationDefinitionNode,
): TypeFieldSelection[] {
  const typeSelections = new Map<string, Set<string>>();

  // Determine the root type based on operation kind
  const rootType = {
    query: schema.getQueryType(),
    mutation: schema.getMutationType(),
    subscription: schema.getSubscriptionType(),
  }[operation.operation];

  if (rootType) {
    // Process the operation using iterative traversal (more efficient than recursion)
    collectTypeSelectionsIteratively(operation.selectionSet.selections, typeSelections, rootType);
  }

  // Convert Map to TypeFieldSelection array
  return Array.from(typeSelections.entries()).map(([typeName, selectedFields]) => ({
    typeName,
    selectedFields,
  }));
}

/**
 * Iteratively traverses GraphQL selections to collect type information.
 *
 * ALGORITHM:
 * - Uses breadth-first traversal with a processing queue
 * - Each level processes all current selections
 * - Collects nested selections for the next level
 * - Continues until no more nested selections exist
 *
 * WHY ITERATIVE:
 * - Avoids stack overflow on deeply nested queries
 * - Better performance than recursive approach
 * - Easier to debug and understand flow
 */
function collectTypeSelectionsIteratively(
  initialSelections: readonly any[],
  typeSelections: Map<string, Set<string>>,
  initialParentType: any,
) {
  // Queue of selections to process: [{ selections, parentType }]
  let processingQueue = [{ selections: initialSelections, parentType: initialParentType }];

  // Process queue until empty (breadth-first traversal)
  while (processingQueue.length > 0) {
    // Process current level and build next level queue
    processingQueue = processingQueue.flatMap(({ selections, parentType }) =>
      selections
        .filter(selection => selection.kind === Kind.FIELD) // Only process field selections
        .map(selection => selection as FieldNode)
        .filter(field => isObjectType(parentType) && parentType.getFields()[field.name.value]) // Valid fields only
        .flatMap(field => {
          const fieldDef = parentType.getFields()[field.name.value];
          const fieldType = getBaseType(fieldDef.type); // Unwrap NonNull/List wrappers

          // Track object types and their selected fields
          if (isObjectType(fieldType)) {
            const typeName = fieldType.name;

            // Initialize field set for this type
            if (!typeSelections.has(typeName)) {
              typeSelections.set(typeName, new Set());
            }

            // Process nested selections if they exist
            if (field.selectionSet) {
              // Record all selected fields for this type
              field.selectionSet.selections
                .filter(nestedSelection => nestedSelection.kind === Kind.FIELD)
                .forEach(nestedSelection => {
                  const nestedField = nestedSelection as FieldNode;
                  typeSelections.get(typeName)!.add(nestedField.name.value);
                });

              // Queue nested selections for next iteration
              return [{ selections: field.selectionSet.selections, parentType: fieldType }];
            }
          }

          return []; // No nested selections to queue
        }),
    );
  }
}
