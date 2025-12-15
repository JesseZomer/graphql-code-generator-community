/* eslint-disable @typescript-eslint/no-explicit-any */
import { isListType, isNonNullType } from 'graphql';

/**
 * Check if a GraphQL field type is a list type.
 * Unwraps NonNull wrappers before checking.
 *
 * @example
 * ```typescript
 * const userType = schema.getType('User');
 * const friendsField = userType.getFields()['friends'];
 * isFieldListType(friendsField.type); // true if [User!]! or [User]
 * ```
 */
export function isFieldListType(type: any): boolean {
    const unwrappedType = isNonNullType(type) ? type.ofType : type;
    return isListType(unwrappedType);
}

/**
 * Convert context path to underscore-separated format for function names.
 * Maintains the original casing from the GraphQL file.
 *
 * @example
 * ```typescript
 * contextToCamelCase('messages.author.address');
 * // Returns: 'messages_author_address'
 *
 * contextToCamelCase('vaksecties.vakanties');
 * // Returns: 'vaksecties_vakanties'
 * ```
 *
 * @note For interface/union variants, the contextPath already includes the concrete type name
 */
export function contextToCamelCase(contextPath: string): string {
    if (!contextPath) return '';
    return contextPath.split('.').join('_');
}

/**
 * Convert context path to PascalCase for type names.
 * Optionally append a concrete type name for interface/union types.
 *
 * @example
 * ```typescript
 * contextToPascalCase('messages.author');
 * // Returns: '_Messages_Author'
 *
 * contextToPascalCase('toekenningen', 'WeekToekenning');
 * // Returns: '_ToekenningenWeekToekenning'
 * ```
 */
export function contextToPascalCase(contextPath: string, concreteTypeName?: string): string {
    if (!contextPath) return '';

    const basePath =
        '_' +
        contextPath
            .split('.')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('_');

    if (concreteTypeName) {
        return basePath + concreteTypeName.charAt(0).toUpperCase() + concreteTypeName.slice(1);
    }
    return basePath;
}

/**
 * Recursively unwrap NonNull and List wrappers to get the base type.
 *
 * @example
 * ```typescript
 * // For type [User!]!
 * const baseType = getBaseType(fieldType);
 * // Returns: User (GraphQLObjectType)
 *
 * // For type String!
 * const baseType = getBaseType(fieldType);
 * // Returns: String (GraphQLScalarType)
 * ```
 */
export function getBaseType(type: any): any {
    return type.ofType ? getBaseType(type.ofType) : type;
}

/**
 * Get mock value for GraphQL primitive types.
 * Returns appropriate default values for String, Int, Float, Boolean, ID.
 *
 * @example
 * ```typescript
 * getPrimitiveMockValue('String', 'name'); // "'name'"
 * getPrimitiveMockValue('Int', 'age'); // '1'
 * getPrimitiveMockValue('Boolean', 'active'); // 'true'
 * getPrimitiveMockValue('ID', 'userId'); // "'userId'"
 * ```
 */
export function getPrimitiveMockValue(typeName: string, fieldName: string): string {
    switch (typeName) {
        case 'String':
            return `'${fieldName}'`;
        case 'Int':
            return '1';
        case 'Float':
            return '1.0';
        case 'Boolean':
            return 'true';
        case 'ID':
            return `'${fieldName}'`;
        default:
            return `'${fieldName}'`;
    }
}

/**
 * Get mock value for a scalar type based on configuration.
 * Returns the configured scalar value or a default based on field name.
 *
 * @example
 * ```typescript
 * getScalarMockValue('new Date()', 'createdAt'); // 'new Date()'
 * getScalarMockValue('Date', 'updatedAt'); // 'new Date()'
 * getScalarMockValue(undefined, 'email'); // "'email'"
 * getScalarMockValue('string', 'name'); // "'name'"
 * ```
 */
export function getScalarMockValue(scalarType: string | undefined, fieldName: string): string {
    // Handle undefined or null scalarType
    if (!scalarType) {
        return `'${fieldName}'`;
    }

    // Handle common TypeScript types
    if (scalarType === 'Date') {
        return 'new Date()';
    }
    if (scalarType === 'string') {
        return `'${fieldName}'`;
    }
    if (scalarType === 'number') {
        return '1';
    }
    if (scalarType === 'boolean') {
        return 'true';
    }

    // For configured scalar values that are already expressions (e.g., 'new Date()'),
    // return them as-is
    return scalarType;
}
