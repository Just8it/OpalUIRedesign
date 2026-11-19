import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Availability tests need real widget metadata, without starting browser UI modules.
// Read the registry's actual imports and literal fields rather than a second fixture table.
registerHooks({ load(url, context, nextLoad) {
    if (!url.endsWith('/src/widgets/index.ts')) return nextLoad(url, context);
    const source = ts.createSourceFile(url, readFileSync(new URL(url), 'utf8'), ts.ScriptTarget.Latest, true);
    const widgets = [];
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
        const imported = statement.importClause?.namedBindings;
        if (!imported || !ts.isNamedImports(imported)) continue;
        for (const binding of imported.elements) {
            const name = binding.name.text;
            if (!name.endsWith('Widget')) continue;
            const path = new URL(statement.moduleSpecifier.text + '.ts', url);
            const definition = ts.createSourceFile(path.href, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
            for (const declaration of definition.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations])) {
                if (declaration.name.getText(definition) !== name || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
                const fields = declaration.initializer.properties.filter(p => ts.isPropertyAssignment(p) && ['id', 'opalPortletOrder', 'requires'].includes(p.name.getText(definition)));
                widgets.push('{' + fields.map(p => p.getText(definition)).join(',') + '}');
            }
        }
    }
    return {format:'module', source:'export const WIDGETS = new Map([' + widgets.map(w => `(${w})`).join(',') + '].map(w => [w.id,w]));',shortCircuit:true};
}});
