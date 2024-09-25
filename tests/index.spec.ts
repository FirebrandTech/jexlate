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
  it('should throw an error if a required field is missing', () => {
    expect.assertions(1);
    const jexlate = new Jexlate({
      FirstName: {
        from: 'first_name',
        required: true,
      },
    });
    try {
      jexlate.parse({});
    } catch (e) {
      expect(JSON.parse(e.message).required[0]).toBe('FirstName');
    }
  });
  it('should evaluate a validation statement', () => {
    expect.assertions(2);
    const jexlate = new Jexlate({
      Age: {
        from: 'age',
        validate: 'age > 25',
      },
    });
    try {
      jexlate.parse({ age: 24 });
    } catch (e) {
      const obj = JSON.parse(e.message).invalid[0].Age;
      expect(obj.test).toBe('age > 25');
      expect(obj.value).toBe(24);
    }
  });
  it('should evaluate an if and required statement to ensure condition are met', () => {
    expect.assertions(1);
    const jexlate = new Jexlate({
      Age: {
        from: 'age',
        if: 'age > 25',
        required: true,
      },
    });
    try {
      jexlate.parse({ age: 24 });
    } catch (e) {
      expect(JSON.parse(e.message).required[0]).toBe('Age');
    }
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
  it('should throw an error if onError is set to `throw`', (done) => {
    expect.assertions(1);
    const jexlate = new Jexlate({
      FirstName: {
        from: 'first_name',
        required: true,
      },
    });
    const stream = jexlate.stream({ onError: 'throw' });
    stream.on('error', (err) => {
      expect(JSON.parse(err.message).required[0]).toBe('FirstName');
      done();
    });
    stream.write({});
    stream.end();
  });
  it('should collect errors if onError is set to `collect`', (done) => {
    const jexlate = new Jexlate({
      FirstName: {
        from: 'first_name',
        required: true,
      },
    });
    const errorCollector = [];
    const stream = jexlate.stream({
      onError: 'continue',
      errorCollector,
    });
    let out = [];
    stream.on('data', (chunk) => {
      out.push(chunk);
    });
    stream.on('end', () => {
      expect(errorCollector[0].required[0]).toEqual('FirstName');
      done();
    });
    stream.write({});
    stream.end();
  });
});
