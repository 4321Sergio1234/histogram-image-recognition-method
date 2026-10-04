const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-description',
  'title',
  'description',
  'placeholder',
  'label',
]);

/** Checks only text rendered by JSX; CSS classes, routes and data values remain ordinary literals. */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Keep visible UI copy in named constants owned by its component or slice',
    },
    schema: [],
    messages: { extract: 'Move this UI text into a named copy constant or formatter.' },
  },
  create(context) {
    function checkText(node) {
      if (!node) {
        return;
      }
      if (node.type === 'Literal' && typeof node.value === 'string' && node.value.trim()) {
        context.report({ node, messageId: 'extract' });
      } else if (
        node.type === 'TemplateLiteral' &&
        node.quasis.some((part) => /\p{L}/u.test(part.value.cooked ?? part.value.raw))
      ) {
        context.report({ node, messageId: 'extract' });
      } else if (node.type === 'ConditionalExpression') {
        checkText(node.consequent);
        checkText(node.alternate);
      } else if (node.type === 'LogicalExpression') {
        checkText(node.right);
      } else if (node.type === 'BinaryExpression' && node.operator === '+') {
        checkText(node.left);
        checkText(node.right);
      }
    }
    return {
      JSXText(node) {
        if (node.value.trim()) {
          context.report({ node, messageId: 'extract' });
        }
      },
      JSXAttribute(node) {
        if (TEXT_ATTRIBUTES.has(node.name.name)) {
          checkText(
            node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value,
          );
        }
      },
      JSXExpressionContainer(node) {
        if (node.parent.type !== 'JSXAttribute') {
          checkText(node.expression);
        }
      },
    };
  },
};
