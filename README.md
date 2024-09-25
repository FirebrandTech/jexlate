[![Tests](https://github.com/FirebrandTech/jexlate/actions/workflows/tests.yml/badge.svg)](https://github.com/FirebrandTech/jexlate/actions/workflows/tests.yml)

# Jexlate

Format and validate JSON data with ease (oh... and [Jexl](https://www.npmjs.com/package/jexl/v/0.1.0)). Jexlate uses Jexl to allow for complex tranformations and translations able to be stored in a JSON object.

A prime use-case would be to store transformations in a database without needing to maintain them in source code. This allows for dynamic transformations to be applied to data without needing to redeploy the application code.

## Installation

```bash
npm i jexlate
# or
yarn add jexlate
```

---

## Usage

Jexlate is a JSON transformation library that uses [Jexl](https://www.npmjs.com/package/jexl/v/0.1.0) to transform data from a source object to a target object format. A very simple example is shown below, simply changing 2 keys to CamelCase, and create a new key with the full name concatenated from the first and last name:

```typescript
import { Jexlate } from 'jexlate';

// Define a transformation template
const template = {
  FirstName: {
    from: 'first_name',
  },
  LastName: {
    from: 'last_name',
  },
  FullName: {
    from: 'first_name + " " + last_name',
  },
};

// Instantiate a new Jexlate instance
const jexlate = new Jexlate(template, options);

// Transform data
const data = {
  first_name: 'John',
  last_name: 'Doe',
};

const transformedData = jexlate.transform(data);

/**
 * transformedData:
 * {
 *   FirstName: 'John',
 *   LastName: 'Doe',
 *   FullName: 'John Doe',
 * }
 */
```

### Options

The `Jexlate` constructor accepts an optional `options` object as the second argument. The following options are available:

```typescript
const options = {
  transforms: {
    uppercase: (value) => value.toUpperCase(),
    // 'first_name|uppercase' => 'JOHN'
  },
  functions: {
    concat: (...args) => args.join(''),
    // 'concat(first_name, " ", last_name)' => 'John Doe'
  },
  binaryOps: {
    add: {
      precedence: 1,
      fn: (left, right) => left + right,
    },
    // '10 add 5' => 15
  },
};
```

## Streams

Jexlate also supports transforming streams of data. This is useful for transforming large datasets without needing to load the entire dataset into memory.

```typescript
import { Jexlate } from 'jexlate';

// Define template and options...

const jexlate = new Jexlate(template, options);

// Create a Jexlate transform stream
const jexlateTransformStream = jexlate.stream();

// Open a readable stream and pipe it through the Jexlate transform stream

const readableStream = someReadableStream();
const writableStream = someWritableStream();

// Pipe the readable stream through the Jexlate transform stream and then to the writable stream
readableStream.pipe(jexlateTransformStream).pipe(writableStream);
```

### Stream Options

The `stream` method accepts an optional `options` object as the first argument. The following options are available:

```typescript
const options = {
  onError: string<throw | collect>
  errorCollector: []
};
```

By default the stream will throw on any validation or processing errors. If you want to continue the stream and collect errors, you can set `onError` to `collect`.

An optional `errorCollector` array can be passed to collect errors when `onError` is set to `collect`.

## Operations and Configation

### Basic Transformations

```typescript
const template = {
  FirstName: {
    from: 'first_name',
  },
  LastName: {
    from: 'last_name',
  },
  FullName: {
    from: 'first_name + " " + last_name',
  },
};
```

### Nested Onjects

Templates can use dot-notation to access nested objects in the source data.

```typescript
const data = {
  company: {
    name: 'Acme Inc.',
    streetAddress: '123 Main St.',
  },
};

const template = {
  Company: {
    Name: {
      from: 'company.name',
    },
    Address: {
      Street: {
        from: 'company.streetAddress',
      },
    },
  },
};

/**
 * transformedData:
 * {
 *   Company: {
 *     Name: 'Acme Inc.',
 *     Address: {
 *       Street: '123 Main St.',
 *     },
 *   },
 * }
 */
```

### Arrays

Arrays can be transformed by using the `[]` syntax in the `from` value.

```typescript
const data = {
  users: [{ name: 'John Doe' }, { name: 'Jane Doe' }],
};

const template = {
  Users: {
    from: 'users[]',
    values: {
      Name: {
        from: 'name',
      },
    },
  },
};

/**
 * transformedData:
 * {
 *   Users: [
 *     { Name: 'John Doe' },
 *     { Name: 'Jane Doe' },
 *   ],
 * }
 */
```

### Conditional Transformations

Jexlate supports conditional transformations using the `if` key in the template.

```typescript
const data = {
  age: 25,
};

const template = {
  IsAdult: {
    from: 'age',
    if: 'age >= 18',
  },
  CanRetire: {
    from: 'age',
    if: 'age >= 65',
  },
};

/**
 * transformedData:
 * {
 *   IsAdult: true,
 *   CanRetire: false,
 * }
 */
```

### Required Properties

Jexlate can be configured to require certain properties to be present in the source data. If a required property is missing, an error will be thrown. This will also throw if a condition or transformation fails or returns `false` or `undefined`

```typescript
const template = {
  FirstName: {
    from: 'first_name',
    required: true,
  },
  LastName: {
    from: 'last_name',
    required: true,
  },
};

const data = {
  first_name: 'John',
};

// Throws an error because 'last_name' is missing
const transformedData = jexlate.transform(data);

// JSON contained in the error object:
// { required: ['last_name'] }
```

### Validation

Jexlate can be configured to validate the transformed data using a JSON schema. If the transformed data does not match the schema, an error will be thrown. Validation uses Jexl syntax, functions, and binary operators.

```typescript
const template = {
  Age: {
    from: 'age',
    validate: 'age > 25',
  },
};

const data = {
  age: 24,
};

// Throws an error because 'age' is less than 25
const transformedData = jexlate.transform(data);

// JSON contained in the error object:
// { invalid: [{ test: 'age > 25', value: 24 }] }
```

### Static Values

Jexl will attempt to evaluate the `from` value as an expression. If you want to use a static value, you can wrap the value one of the functions below:

```typescript
const template = {
  StringValue: {
    from: 'value(string)',
  },
  NumberValue: {
    from: 'number(43)',
  },
  IsTrue: {
    from: 'boolean(true)',
  },
  IsFalse: {
    from: 'boolean(false)',
  },
  NullValue: {
    from: 'null()',
  },
};
```

### Type Coercion

Jexlate will attempt to coerce values to the correct type based on the `from` value. If you want to force a value to be a specific type, you can use the following functions:

```typescript
const template = {
  AgeAsString: {
    from: 'age',
    as: 'string', // 'string' | 'number' | 'boolean' | 'json'
  },
};

const data = {
  age: 25,
};

// transformedData: { AgeAsString: '25' }
```

...

## Development

## Install Dependencies

```bash
yarn
```

## Run Tests

```bash
yarn test
# or
yarn test:watch
```

## Build

```bash
yarn build
yarn build:types
```
