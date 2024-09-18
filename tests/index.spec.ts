import { Jexlate } from '../src/index';

describe('Jexlate', () => {
  it('should return a static value when supplied', () => {
    const jexlate = new Jexlate({
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
    });
    const result = jexlate.parse({});
    expect(result).toEqual({
      StringValue: 'string',
      NumberValue: 43,
      IsTrue: true,
      IsFalse: false,
      NullValue: null,
    });
  });
  it('should perform a basic translation', () => {
    const jexlate = new Jexlate({
      FirstName: {
        from: 'first_name',
      },
    });
    const result = jexlate.parse({ first_name: 'John' });
    expect(result).toEqual({ FirstName: 'John' });
  });
  it('should perform a tranform on a child object', () => {
    const jexlate = new Jexlate({
      Company: {
        Name: {
          from: 'company.name',
        },
      },
    });
    const result = jexlate.parse({ company: { name: 'Acme Inc' } });
    expect(result).toEqual({ Company: { Name: 'Acme Inc' } });
  });
  it('should perform a transform on an array', () => {
    const jexlate = new Jexlate({
      Companies: {
        from: 'companies[]',
        values: {
          Name: {
            from: 'name',
          },
        },
      },
    });
    const result = jexlate.parse({ companies: [{ name: 'Acme Inc' }] });
    expect(result).toEqual({ Companies: [{ Name: 'Acme Inc' }] });
  });
  it('should throw an error if a required field is missing', () => {
    const jexlate = new Jexlate({
      FirstName: {
        from: 'first_name',
        required: true,
      },
    });
    expect(() => jexlate.parse({})).toThrow(
      'Required fields are missing or invalid: FirstName'
    );
  });
  it('should evaluate an if statement', () => {
    const jexlate = new Jexlate({
      Age: {
        from: 'age',
        if: 'age > 25',
      },
    });
    const result = jexlate.parse({ age: 24 });
    expect(result).toEqual({});
  });
  it('should evaluate an if and required statement to ensure condition are met', () => {
    const jexlate = new Jexlate({
      Age: {
        from: 'age',
        if: 'age > 25',
        required: true,
      },
    });
    expect(() => jexlate.parse({ age: 24 })).toThrow(
      'Required fields are missing or invalid: Age'
    );
  });
  it('should support jexl custom functions', () => {
    const jexlate = new Jexlate(
      {
        FullName: {
          from: "concat(first_name, ' ', last_name)",
        },
      },
      {
        functions: {
          concat: (...args) => args.join(''),
        },
      }
    );
    const result = jexlate.parse({ first_name: 'John', last_name: 'Doe' });
    expect(result).toEqual({ FullName: 'John Doe' });
  });
  it('should support jexl custom transforms', () => {
    const jexlate = new Jexlate(
      {
        FirstName: {
          from: 'first_name|uppercase',
        },
      },
      {
        transforms: {
          uppercase: (value) => value.toUpperCase(),
        },
      }
    );
    const result = jexlate.parse({ first_name: 'John' });
    expect(result).toEqual({ FirstName: 'JOHN' });
  });
  it('should support jexl custom binary operators', () => {
    const jexlate = new Jexlate(
      {
        AgeInTenYears: {
          from: 'age add 10',
        },
      },
      {
        binaryOps: {
          add: {
            precedence: 1,
            fn: (left, right) => left + right,
          },
        },
      }
    );
    const result = jexlate.parse({ age: 26 });
    expect(result).toEqual({ AgeInTenYears: 36 });
  });
  it('should attempt to assume type if not provided', () => {
    const jexlate = new Jexlate({
      IsNumber: {
        from: 'isNumber',
      },
      IsTrue: {
        from: 'isTrue',
      },
      IsFalse: {
        from: 'isFalse',
      },
      IsNull: {
        from: 'isNull',
      },
    });
    const result = jexlate.parse({
      isNumber: '26',
      isTrue: 'true',
      isFalse: 'false',
      isNull: 'null',
    });
    expect(result).toEqual({
      IsNumber: 26,
      IsTrue: true,
      IsFalse: false,
      IsNull: null,
    });
  });
  it('should support type coercion', () => {
    const jexlate = new Jexlate({
      Age: {
        from: 'age',
        as: 'number',
      },
    });
    const result = jexlate.parse({ age: '26' });
    expect(result).toEqual({ Age: 26 });
  });
  it('should support streaming', (done) => {
    const jexlate = new Jexlate({
      FirstName: {
        from: 'first_name',
      },
      LastName: {
        from: 'last_name',
      },
    });
    const stream = jexlate.stream();
    let out = [];
    stream.on('data', (chunk) => {
      out.push(chunk);
    });
    stream.on('end', () => {
      expect(out).toEqual([{ FirstName: 'John', LastName: 'Doe' }]);
      done();
    });
    stream.write({ first_name: 'John', last_name: 'Doe' });
    stream.end();
  });
});
