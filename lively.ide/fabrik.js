import { connect, once } from 'lively.bindings';
import { Color, rect, pt } from 'lively.graphics';
import { arr } from 'lively.lang';
import { morph } from 'lively.morphic';
import { Leash } from 'lively.components/widgets.js';
import { showConnector, show } from 'lively.halos/markers.js';
import { InteractiveMorphSelector } from 'lively.halos/morph.js';
import { classToFunctionTransform } from 'lively.classes';

export function interactivelyShowConnection (connection) {
  const { sourceObj, sourceAttrName, targetObj, targetMethodName } = connection;
  if (sourceObj.isMorph && targetObj.isMorph) {
    sourceObj.show();
    targetObj.show();
    showConnector && showConnector(sourceObj, targetObj);
  } else show(String(connection));
}

export function printConnection (connection) {
  const {
    sourceObj, sourceAttrName, targetObj, targetMethodName
  } = connection;
  const converter = connection.getConverter();
  const updater = connection.getUpdater();
  return printConnectionElements(
    sourceObj, sourceAttrName, targetObj, targetMethodName,
    converter, updater);
}

export function printConnectionElements (
  sourceObj, sourceAttr, targetObj, targetAttr,
  converter, updater
) {
  let source = `/* global connect, source, target */
connect(source, '${sourceAttr}', target, '${targetAttr}'`;
  if (converter || updater) source += ', {\n';
  if (converter) source += `  converter: ${converter}`;
  if (converter && updater) source += ',';
  if (converter) source += '\n';
  if (updater) source += `  updater: ${updater}\n`;
  if (converter || updater) source += '}';
  source += ');';
  return source;
}

export async function interactiveConnectGivenSource (sourceObj, sourceAttr) {
  const selected = await InteractiveMorphSelector.selectMorph();
  return selected
    ? interactiveConnectGivenSourceAndTarget(sourceObj, sourceAttr, selected)
    : null;
}

export async function interactiveConnectGivenSourceAndTarget (sourceObj, sourceAttr, targetObj, onConnect) {
  const targetBindings = targetObj && targetObj.world().targetDataBindings(targetObj);
  const world = sourceObj.world();
  const prompts = [];
  if (!targetBindings || !targetBindings.length) {
    world.setStatusMessage('connect canceled');
    return;
  }

  if (!sourceAttr) {
    const sourceBindings = [{ isListItem: true, string: '[Enter custom attribute..]', value: { custom: true } }, ...sourceObj.world().targetDataBindings(sourceObj).flat().map(ea => ({ isListItem: true, string: ea.signature || ea.name, value: ea }))];
    sourceAttr = await world.listPrompt(['Select Source Attribute\n', {}, 'Choose the attribute of the morph that is supposed to invoke the connection. This can be a method, property or a custom signal that is invoked upon the morph.', { paddingTop: '10px', fontSize: 14, textAlign: 'left', fontWeight: 'normal' }], sourceBindings, { filterable: true });
    if (sourceAttr.status == 'canceled') return;
    sourceAttr = sourceAttr.selected[0];
    sourceAttr = sourceAttr.custom ? 'sourceAttribute' : sourceAttr.name;
  }

  const items = [{ isListItem: true, string: '[Enter custom attribute...]', value: { custom: true } }, ...targetBindings.flat().map(ea => ({ isListItem: true, value: ea, string: ea.signature || ea.name }))];

  let res = await world.listPrompt(['Select Target Attribute\n', {}, 'Choose the attribute of the morph that is supposed to invoked once the connection is triggered. This can be either a method or a property of the morph. When selecting a property, keep in mind that the value of the source attribute will be assigned to the property or passed to the method as an argument.', { fontSize: 14, textAlign: 'left', fontWeight: 'normal', paddingTop: '10px' }], items, { filterable: true });

  if (res.status == 'canceled') return;
  res = res.selected[0];

  await interactivelyEvaluateConnection({ sourceObj, sourceAttr, targetObj, targetAttr: res.custom ? 'targetAttribute' : res.name, onConnect, prompt: 'Edit and confirm connection:' });
}

export async function interactivelyReEvaluateConnection (
  connection, prompt = 'confirm connection', highlight, onConnect
) {
  const {
    sourceObj, sourceAttrName, targetObj, targetMethodName
  } = connection;
  const converter = connection.getConverter();
  const updater = connection.getUpdater();
  return interactivelyEvaluateConnection({
    sourceObj,
    sourceAttr: sourceAttrName,
    targetObj,
    targetAttr: targetMethodName,
    converter,
    updater,
    prompt,
    highlight,
    onConnect
  });
}

export function visualizeConnection (m1, m2, existingLeash, leashStyle = {}, orientation = 'left') {
  // if m2 is not a morph, then render a data pointer (to open inspector)
  const sides = rect(0).sides.concat(rect(0).corners);
  const leash = existingLeash || new Leash({
    isSmooth: true,
    styleClasses: ['Halo'],
    borderColor: Color.orange,
    epiMorph: true,
    endpointStyle: {
      start: { fill: Color.transparent, nativeCursor: 'auto' },
      end: { fill: Color.orange }
    },
    ...leashStyle,
    hasFixedPosition: true
  });
  // fixme: the attachment points of the leashes should be parametrized...
  leash.startPoint.attachTo(m1, 'rightCenter');
  if (m2.isMorph) {
    let nearestPart = m2.globalBounds().partNameNearest(sides, m1.globalPosition);
    if (m1.globalPosition.equals(m2.globalBounds().partNamed(nearestPart))) {
      // pick another part, that is not exactly the same
      nearestPart = m2.globalBounds().partNameNearest(arr.without(sides, nearestPart), m1.globalPosition);
    }
    leash.endPoint.attachTo(m2, 'leftCenter');
  } else {
    const virtualNodePos = m1.globalBounds().topRight().addPt(pt(100, 0));
    const visualPointer = morph({
      type: 'label',
      value: m2.toString(),
      styleClasses: ['Tooltip'],
      padding: rect(8, 4)
    }).openInWorld(virtualNodePos);
    visualPointer.position = m1.world().bounds().translateForInclusion(visualPointer.bounds()).topLeft();
    // if (visualPointer.bounds().intersection(this.globalBounds()).area() > 0) {
    //   visualPointer.top = this.owner.globalBounds().insetBy(-20).bottom();
    // }
    once(leash, 'remove', visualPointer, 'remove');
    leash.endPoint.attachTo(visualPointer, 'leftCenter');
  }
  return leash;
}

export async function interactivelyEvaluateConnection (opts) {
  let {
    sourceObj, sourceAttr, targetObj, targetAttr, converter, updater,
    prompt, // = "confirm connection",
    highlight = true, onConnect
  } = opts;
  const targetModule = 'lively://lively.bindings-interactive-connect/x' + sourceObj.id;
  const evalEnvironment = {
    context: window,
    format: 'esm',
    targetModule,
    classTransform: classToFunctionTransform
  };
  const input = printConnectionElements(sourceObj, sourceAttr, targetObj, targetAttr, converter, updater);
  if (targetObj.isMorph && sourceObj.isMorph) {
    // figure out if the properties can be coerced naively
    const { type: targetType } = targetObj.propertiesAndPropertySettings().properties[targetAttr] || {
      type: typeof targetObj[targetAttr]
    };
    const { type: sourceType } = sourceObj.propertiesAndPropertySettings().properties[sourceAttr] || {
      type: typeof sourceObj[sourceAttr]
    };
    if (sourceType !== targetType) {
      prompt = [
        'Edit and confirm connection:\n', {},
        'Source: ', { fontSize: 14, fontWeight: 'normal' }, sourceObj.toString(), { fontSize: 14, fontWeight: 'normal', fontStyle: 'italic' },
        '\nTarget: ', { fontSize: 14, fontWeight: 'normal' }, targetObj.toString(), { fontSize: 14, fontWeight: 'normal', fontStyle: 'italic' }
      ];
    }
  }
  Object.assign(lively.modules.module(targetModule).recorder,
    { source: sourceObj, target: targetObj, connect, once, [sourceAttr]: sourceObj[sourceAttr] });
  let source;
  if (prompt) {
    source = await $world.editPrompt(prompt, {
      input,
      historyId: 'lively.bindings-interactive-morph-connect',
      mode: 'js',
      requester: $world,
      evalEnvironment,
      animated: false
    });
    if (!source) { $world.setStatusMessage('connect canceled'); return; }
  } else {
    source = input;
  }
  const result = await lively.vm.runEval(source, evalEnvironment);
  if (result.isError) {
    $world.logError(result.value);
    return interactivelyEvaluateConnection({
      sourceObj,
      sourceAttr,
      targetObj,
      targetAttr,
      converter,
      updater,
      prompt: 'confirm connection',
      highlight,
      onConnect
    });
  }
  if (highlight) {
    $world.setStatusMessage('connected!', Color.green);
    interactivelyShowConnection(result.value);
  }
  if (typeof onConnect === 'function') {
    onConnect(result);
  }
}
