/*global beforeEach, afterEach, describe, it*/

import { expect } from "mocha-es6";

import * as query from "../lib/query.js";
import { parse } from "../lib/parser.js";
import { arr, obj, chain, fun } from "lively.lang";

describe('query', function() {

  describe("toplevel", () => {

    it("declsAndRefsInTopLevelScope", function() {
      var code = "var x = 3;\n function baz(y) { var zork; return xxx + zork + x + y; }\nvar y = 4, z;\nbar = 'foo';"
      var parsed = parse(code);
      var declsAndRefs = query.topLevelDeclsAndRefs(parsed);

      var varDecls = declsAndRefs.varDecls;
      var varIds = chain(declsAndRefs.varDecls).pluck('declarations').flat().pluck("id").pluck("name").value();
      expect(["x", "y", "z"]).deep.equals(varIds, "var ids");

      var funcIds = chain(declsAndRefs.funcDecls).pluck('id').pluck('name').value();
      expect(["baz"]).deep.equals(funcIds, "funIds: " + obj.inspect(funcIds));

      var refs = declsAndRefs.refs;
      var refIds = chain(refs).pluck('name').value();
      expect(["bar", "xxx", "x"]).deep.equals(refIds, "ref ids");
    });

    it("recognize function declaration", function() {
      var code = "this.addScript(function run(n) { if (n > 0) run(n-1); show('done'); });",
          result = query.topLevelDeclsAndRefs(code),
          expected = ["show"];
      expect(expected).deep.equals(result.undeclaredNames);
    });

    it("recognize arrow function declaration", function() {
      var code = "this.addScript((n, run) => { if (n > 0) run(n-1); show('done'); });",
          result = query.topLevelDeclsAndRefs(code),
          expected = ["show"];
      expect(expected).deep.equals(result.undeclaredNames);
    });

    it("recognize class declaration", function() {
      var code = "class Foo {\n" + "  constructor(name) { this.name = name; }\n" + "}\n"+ "new Foo();",
          result = query.topLevelDeclsAndRefs(code),
          expected = [];
      expect(expected).deep.equals(result.undeclaredNames);
    });

    it("finds this references", function() {
      var code = "this.foo = this.bar;",
          result = query.topLevelDeclsAndRefs(code),
          expected = [{start: 0}, {start: 0}];
      expect(result.thisRefs).to.containSubset(expected);
    });

  });

  describe("toplevel func decls", () => {

    it("tested-action", () => {
      var code = "var baz = function zork() { function barf() {} }\nfunction foo() { function bar() {}; }",
          parsed = parse(code),
          funcDecls = query.topLevelFuncDecls(parsed);
      expect(funcDecls).to.deep.equal([{node: parsed.body[1], path: ["body", 1]}]);
    });

  });


  describe("scoping", () => {

    it("scopes", function() {
      var code = "var x = {y: 3}; function foo(y) { var foo = 3, baz = 5; x = 99; bar = 2; bar; Object.bar = 3; this.x = this.foo + 23; }";
      var parsed = parse(code);
      var scope = query.scopes(parsed);
      var expected = {
        node: parsed,
        varDecls: [{declarations: [{id: {name: 'x'}}]}],
        funcDecls: [{id: {name: 'foo'}}],
        params: [],
        refs: [],
        thisRefs: [],
        subScopes: [{
          node: parsed.body[1],
          varDecls: [{declarations: [{id: {name: 'foo'}}, {id: {name: 'baz'}}]}],
          funcDecls: [],
          params: [{name: "y"}],
          refs: [{name: "x"}, {name: "bar"}, {name: "bar"}, {name: "Object"}],
          thisRefs: [{type: "ThisExpression"}, {type: "ThisExpression"}]
        }]
      }

      expect(scope).to.containSubset(expected)

      // top level scope
      var varNames = chain(scope.varDecls).pluck('declarations').flat().value();
      expect(1).equals(varNames.length, 'root scope vars');
      var funcNames = chain(scope.funcDecls).pluck('id').pluck('name').value();
      expect(1).equals(scope.funcDecls.length, 'root scope funcs');
      expect(0).equals(scope.params.length, 'root scope params');
      expect(0).equals(scope.refs.length, 'root scope refs');

      // sub scope
      expect(1).equals(scope.subScopes.length, 'subscope length');
      var subScope = scope.subScopes[0];
      var varNames = chain(subScope.varDecls).pluck('declarations').flat().value();
      expect(2).equals(varNames.length, 'subscope vars');
      expect(0).equals(subScope.funcDecls.length, 'subscope funcs');
      expect(4).equals(subScope.refs.length, 'subscope refs');
      expect(1).equals(subScope.params.length, 'subscope params');
    });

  });


  describe("finding globals", () => {

    it("findGlobalVars", function() {
      var code = "var margin = {top: 20, right: 20, bottom: 30, left: 40},\n"
               + "    width = 960 - margin.left - margin.right,\n"
               + "    height = 500 - margin.top - margin.bottom;\n"
               + "function blup() {}\n"
               + "foo + String(baz) + foo + height;\n"
      var result = query.findGlobalVarRefs(code);

      var expected = [{start:169,end:172, name:"foo", type:"Identifier"},
                      {start:182,end:185, name:"baz", type:"Identifier"},
                      {start:189,end:192, name:"foo", type:"Identifier"}];

      expect(result).to.containSubset(expected);
    });

  });


  describe("finding stuff from a source location", () => {

    it("findNodesIncludingLines", function() {
      var code = "var x = {\n  f: function(a) {\n   return 23;\n  }\n}\n",
          expected1 = ["Program", "VariableDeclaration", "VariableDeclarator", "ObjectExpression", "Property", "FunctionExpression", "BlockStatement", "ReturnStatement", "Literal"],
          nodes1 = query.findNodesIncludingLines(null, code, [3]);
      expect(expected1).deep.equals(nodes1.map(n => n.type));

      var expected2 = ["Program", "VariableDeclaration", "VariableDeclarator", "ObjectExpression"],
          nodes2 = query.findNodesIncludingLines(null, code, [3,5]);
      expect(expected2).deep.equals(nodes2.map(n => n.type));
    });

    describe("find scopes", function() {

      it("findScopeAtIndex", function() {
        var src = fun.extractBody(function() {
        var x = {
          f: function(a) {
          return function(a) { return a + 1};
          },
          f2: function() {}
        }
        });
        var index = 35; // on first return
        var parsed = parse(src, {addSource: true});
        var result = query.scopesAtIndex(parsed, index);

        var scopes = query.scopes(parsed);
        var expected = [scopes, scopes.subScopes[0]]
        expect(expected).deep.equals(result);
      });

      it("findScopeAtIndexWhenIndexPointsToFuncDecl", function() {
        var src = 'var x = "fooo"; function bar() { var z = "baz" }';
        var parsed = parse(src, {addSource: true});
        var scopes = query.scopes(parsed);

        var index = 26; // on bar
        var result = query.scopeAtIndex(parsed, index);
        expect(scopes).deep.equals(result);

        var index = 34; // inside bar body
        var result = query.scopeAtIndex(parsed, index);
        expect(scopes.subScopes[0]).deep.equals(result);
      });

      it("findScopeAtIndexWhenIndexPointsToArg", function() {
        var src = 'var x = "fooo"; function bar(zork) { var z = zork + "baz"; }';
        var parsed = parse(src, {addSource: true});
        var scopes = query.scopes(parsed);

        var index = 31; // on zork
        var result = query.scopeAtIndex(parsed, index);

        expect(scopes.subScopes[0]).deep.equals(result);
      });

    });

    describe("finding references and declarations", function() {

      it("findDeclarationClosestToIndex", function() {
        var src = `var x = 3, yyy = 4;\nvar z = function() { yyy + yyy + (function(yyy) { yyy+1 })(); }`,
            index = 48, // second yyy of addition
            parsed = parse(src),
            result = query.findDeclarationClosestToIndex(parsed, "yyy", index);
        expect(result).to.containSubset({end:14,name:"yyy",start:11,type:"Identifier"});
      });

      it("findDeclarationClosestToIndex 2", function() {
        var src = `var x = 3, yyy = 4;\nvar z = function() { yyy + yyy + (function(yyy) { yyy+1 })(); }`,
            index = 73, // yyy of function
            parsed = parse(src),
            result = query.findDeclarationClosestToIndex(parsed, "yyy", index);
        expect(result).to.containSubset({end:66,name:"yyy",start:63,type:"Identifier"});
      });

      it("findReferencesAndDeclsInScope find vars", function() {
        var parsed = parse("var x = 3, y = 4;\nvar z = function() { y + y + (function(y) { y+1 })(); }");
        expect(query.findReferencesAndDeclsInScope(query.scopes(parsed), "y")).deep.equals({
          decls: [
            {name:"y", start:11, end:12, type:"Identifier"},
          ],
          refs: [
            {name:"y", start:39, end:40, type:"Identifier"},
            {name:"y", start:43, end:44, type:"Identifier"}
          ]
        });
      });

      it("findReferencesAndDeclsInScope finds this", function() {
        var parsed = parse("this.bar = 23; var x = function() { this.foo(this.zork, function() { this.bark }); };"),
            scope = query.scopes(parsed).subScopes[0];
        expect(query.findReferencesAndDeclsInScope(scope, "this")).to.containSubset({
          decls: [],
          refs: [{end: 40,start: 36, type: "ThisExpression"},
                 {end: 49,start: 45, type: "ThisExpression"}]
        });
      });

    });

  });

  describe("statementOf", () => {

    function itFindsTheStatment(src, getTarget, getExpected) {
      return it(src, () => {
        var parsed = parse(src),
            found = query.statementOf(parsed, getTarget(parsed)),
            expected = getExpected(parsed);
        // expect(expected).to.equal(found, `node not found\nexpected: ${JSON.stringify(expected, null, 2)}\nactual: ${JSON.stringify(found, null, 2)}`);
        expect(JSON.stringify(expected, null, 2)).to.equal(JSON.stringify(found, null, 2));
      });
    }

    itFindsTheStatment(
      'var x = 3; function foo() { var y = 3; return y + 2 }; x + foo();',
      ast => ast.body[1].body.body[1].argument.left,
      ast => ast.body[1].body.body[1]);

    itFindsTheStatment(
      'var x = 1; x;',
      ast => ast.body[1],
      ast => ast.body[1]);

    itFindsTheStatment(
      'switch (123) { case 123: debugger; }',
      ast => ast.body[0].cases[0].consequent[0],
      ast => ast.body[0].cases[0].consequent[0]);

    itFindsTheStatment(
      'if (true) { var a = 1; }',
      ast => ast.body[0].consequent.body[0].declarations[0],
      ast => ast.body[0].consequent.body[0]);

    itFindsTheStatment(
      'if (true) var a = 1;',
      ast => ast.body[0].consequent.declarations[0].id,
      ast => ast.body[0].consequent);

    itFindsTheStatment(
      'if (true) var a = 2;',
      ast => ast.body[0].test,
      ast => ast.body[0]);

    itFindsTheStatment(
      'export default class Foo {}',
      ast => ast.body[0].declaration.id,
      ast => ast.body[0].declaration);

    itFindsTheStatment(
      'a;',
      ast => ast.body[0].expression,
      ast => ast.body[0]);

    it("finds path to statement", () => {
      var parsed = parse('var x = 3; function foo() { var y = 3; return y + 2 }; x + foo();'),
          found = query.statementOf(parsed, parsed.body[1].body.body[1].argument.left, {asPath: true}),
          expected = ["body", 1,"body", "body", 1];
      expect(expected).to.deep.equal(found);
    });

  });

  describe("es6 compat", () => {

    describe("patterns", function() {

      describe("obj destructuring", function() {

        describe("params", function() {

          it("simple", () =>
            expect(query.topLevelDeclsAndRefs("({x}) => { x }").undeclaredNames).deep.equals([]));

          it("default init", () =>
            expect(query.topLevelDeclsAndRefs("({x} = {}) => { x }").undeclaredNames).deep.equals([]));

          it("array", () =>
            expect(query.topLevelDeclsAndRefs("([a, b, ...rest]) => { (a + b).concat(rest); }").undeclaredNames).deep.equals([]));

          it("default init array", () =>
            expect(query.topLevelDeclsAndRefs("([a, b, ...rest] = []) => { (a + b).concat(rest); }").undeclaredNames).deep.equals([]));

          it("alias", function() {
            var code = "({x: y}) => y",
                result = query.topLevelDeclsAndRefs(code),
                expected = [];
            expect(expected).deep.equals(result.undeclaredNames);
          });

          it("nested", function() {
            var code = "({x: {a}}) => a",
                result = query.topLevelDeclsAndRefs(code),
                expected = [];
            expect(expected).deep.equals(result.undeclaredNames);
          });
        });

        describe("vars", function() {
          it("simple", function() {
            var code = "var {x, y} = {x: 3, y: 4};"
            var parsed = parse(code);
            var scopes = query.scopes(parsed);
            expect(["x", "y"]).deep.equals(query._declaredVarNames(scopes));
          });

          it("nested", function() {
            var code = "var {x, y: [{z}]} = {x: 3, y: [{z: 4}]};"
            var parsed = parse(code);
            var scopes = query.scopes(parsed);
            expect(["x", "z"]).deep.equals(query._declaredVarNames(scopes));
          });

          it("let", function() {
            var code = "let {x, y} = {x: 3, y: 4};"
            var parsed = parse(code);
            var scopes = query.scopes(parsed);
            expect(["x", "y"]).deep.equals(query._declaredVarNames(scopes));
          });

        });
      });

      describe("arr destructuring", function() {

        describe("params", function() {
          it("simple", function() {
            var code = "([x,{y}]) => x + y",
                result = query.topLevelDeclsAndRefs(code),
                expected = [];
            expect(expected).deep.equals(result.undeclaredNames);
          });
        });

        describe("vars", function() {
          it("simple", function() {
            var code = "var {x} = {x: 3};",
                parsed = parse(code),
                scopes = query.scopes(parsed);
            expect(["x"]).deep.equals(query._declaredVarNames(scopes));
          });
        });

        describe("...", function() {

          it("as param", function() {
            var code = "(a, ...b) => a + b[0];",
                result = query.topLevelDeclsAndRefs(code),
                expected = [];
            expect(expected).deep.equals(result.undeclaredNames);
          });

          it("as assignment", function() {
            var code = "var [head, ...inner] = [1,2,3,4,5];",
                parsed = parse(code),
                scopes = query.scopes(parsed);
            expect(["head", "inner"]).deep.equals(query._declaredVarNames(scopes));
          });

        });

      });

      it("finds default params", () => {
        var code = "function x(y = 2) { return y; }",
            parsed = parse(code),
            scopes = query.scopes(parsed).subScopes[0];
        expect(["x", "y"]).deep.equals(query._declaredVarNames(scopes));
      });
    });

    describe("templateStrings", function() {
      it("simple", function() {
        var code = "var x = `foo`;",
            parsed = parse(code),
            scopes = query.scopes(parsed);
        expect(["x"]).deep.equals(query._declaredVarNames(scopes));
      });

      it("with expressions", function() {
        var code = "var x = `foo ${y}`;",
            result = query.topLevelDeclsAndRefs(code);
        expect(["y"]).deep.equals(result.undeclaredNames);
      });
    });

    describe("es6 modules", function() {

      it('recognizes export declarations', function() {
        var code = 'export var x = 42; export function y() {}; export default function z() {};',
            parsed = parse(code),
            scopes = query.scopes(parsed);
        expect(["y", "z", "x"]).deep.equals(query._declaredVarNames(scopes));
      });

      it('recognizes import declarations', function() {
        var code = "import foo from 'bar';\n"
                 + "import { baz } from 'zork';\n"
                + "import { qux as corge } from 'quux';\n",
                // rk not yet supported by acorn as of 2016-01-28:
                // + "import { * as grault } from 'garply';\n",
            parsed = parse(code),
            scopes = query.scopes(parsed);
        expect(["foo", "baz", "corge"/*, "grault"*/]).deep.equals(query._declaredVarNames(scopes));
      });

      it('ignores export froms', function() {
        var code = "export { foo } from 'bar';\n",
            parsed = parse(code);
        expect([]).deep.equals(query.findGlobalVarRefs(parsed));
      });
    });


    describe("es6 classes", function() {

      it('recognizes super call', function() {
        var code = "class Foo extends Bar {\n"
                 + "  m() { return super.m() + 2; }\n"
                 + "};\n",
            parsed = parse(code),
            toplevel = query.topLevelDeclsAndRefs(parsed);
        expect(toplevel.undeclaredNames).deep.equals(["Bar"]);
      });

    });

    describe("async", function() {

      it('recognizes async function', function() {
        var code = "async function foo() { return 23 }\nvar x = await foo();",
            parsed = parse(code),
            toplevel = query.topLevelDeclsAndRefs(parsed);
        expect(toplevel.declaredNames).deep.equals(["foo", "x"]);
      });

    });

  });


  describe("helper", function() {
    var objExpr = parse("({x: 23, y: [{z: 4}]});").body[0].expression;
    expect(arr.pluck(query.helpers.objPropertiesAsList(objExpr, [], true), "key"))
      .eql([["x"], ["y", 0, "z"]]);
    expect(arr.pluck(query.helpers.objPropertiesAsList(objExpr, [], false), "key"))
      .eql([["x"], ["y"], ["y", 0, "z"]]);

    var objExpr = parse("var {x, y: [{z}]} = {x: 23, y: [{z: 4}]};").body[0].declarations[0].id;
    expect(arr.pluck(query.helpers.objPropertiesAsList(objExpr, [], true), "key"))
      .eql([["x"], ["y", 0, "z"]]);
    expect(arr.pluck(query.helpers.objPropertiesAsList(objExpr, [], false), "key"))
      .eql([["x"], ["y"], ["y", 0, "z"]]);
  });

  describe("imports", () => {

    function im(src) {
      const scope = query.scopes(parse(src));
      return query.imports(scope);
    }

    it("of named vars", async () => {
      const result = im("import { y as yyy } from './file2.js';");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        fromModule: "./file2.js",
        imported: 'y',
        local: "yyy"
      });
    });

    it("default", async () => {
      const result = im("import z from './file2.js';");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        fromModule: "./file2.js",
        imported: 'default',
        local: 'z'
      });
    });

    it("*", async () => {
      const result = im("import * as file2 from './file2.js';");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        fromModule: "./file2.js",
        imported: "*",
        local: "file2"
      });
    });
  });

  describe("exports", () => {

    function ex(src) {
      const scope = query.scopes(parse(src));
      return query.exports(scope, true);
    }

    it("of ids", async () => {
      const result = ex("var x = 23; export { x }");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "x",
        local: "x",
        type: "id",
        decl: {type: "VariableDeclarator", start: 4, end: 10},
        declId: {type: "Identifier", start: 4, end: 5, name: "x"}
      });
    });

    it("as of ids", async () => {
      const result = ex("var x = 23; export { x as y }");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "y",
        local: "x",
        type: "id",
        decl: {type: "VariableDeclarator", start: 4, end: 10},
        declId: {type: "Identifier", start: 4, end: 5, name: "x"}
      });
    });

    it("of referenced function", async () => {
      const result = ex("function x() {}; export { x }");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "x",
        local: "x",
        type: "id",
        decl: {type: "FunctionDeclaration", start: 0, end: 15},
        declId: {type: "Identifier", start: 9, end: 10, name: "x"}
      });
    });

    it("of var decls", async () => {
      const result = ex("export var x = 23;");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "x",
        local: "x",
        type: "var",
        decl: {type: "VariableDeclarator", start: 11, end: 17},
        declId: {type: "Identifier", start: 11, end: 12, name: "x"}
      });
    });

    it("of multiple var decls", async () => {
      const result = ex("export var x = 23, y = 42;");
      expect(result).to.have.length(2);
      expect(result).to.containSubset([{
        exported: "x",
        local: "x",
        type: "var",
        decl: {type: "VariableDeclarator", start: 11, end: 17},
        declId: {type: "Identifier", start: 11, end: 12, name: "x"}
      },{
        exported: "y",
        local: "y",
        type: "var",
        decl: {type: "VariableDeclarator", start: 19, end: 25},
        declId: {type: "Identifier", start: 19, end: 20, name: "y"}
      }]);
    });

    it("* from", async () => {
      const result = ex("export * from './file1.js'");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "*",
        local: null,
        fromModule: "./file1.js"
      });
    });

    it("named from", async () => {
      const result = ex("export { x } from './file1.js';");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "x",
        fromModule: "./file1.js",
        local: null
      });
    });

    it("named as from", async () => {
      const result = ex("export { x as y } from './file1.js';");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "y",
        imported: "x",
        fromModule: "./file1.js",
        local: null
      });
    });

    it("functions", async () => {
      const result = ex("export function bar() {}");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "bar",
        local: "bar",
        type: "function",
        decl: {type: "FunctionDeclaration", start: 7, end: 24},
        declId: {type: "Identifier", start: 16, end: 19, name: "bar"}
      });
    });

    it("default function", async () => {
      const result = ex("export default async function foo() {}");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "default",
        local: "foo",
        type: "function",
        decl: {type: "FunctionDeclaration", start: 15, end: 38},
        declId: {type: "Identifier", start: 30, end: 33, name: "foo"}
      });
    });

    it("default id", async () => {
      const result = ex("var x = 23; export default x;");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "default",
        local: "x",
        type: "id",
        decl: {type: "VariableDeclarator", start: 4, end: 10},
        declId: {type: "Identifier", start: 4, end: 5, name: "x"}
      });
    });

    it("default expr", async () => {
      const result = ex("export default 12;");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "default",
        type: "expr",
        decl: {type: "Literal", start: 15, end: 17},
        declId: {type: "Literal", start: 15, end: 17, value: 12}
      });
    });

    it("class", async () => {
      const result = ex("export class Baz {}");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "Baz",
        local: "Baz",
        type: "class",
        decl: {type: "ClassDeclaration", start: 7, end: 19},
        declId: {type: "Identifier", start: 13, end: 16, name: "Baz"}
      });
    });

    it("default class", async () => {
      const result = ex("export default class Baz {}");
      expect(result).to.have.length(1);
      expect(result[0]).to.containSubset({
        exported: "default",
        local: "Baz",
        type: "class",
        decl: {type: "ClassDeclaration", start: 15, end: 27},
        declId: {type: "Identifier", start: 21, end: 24, name: "Baz"}
      });
    });

  });

});
