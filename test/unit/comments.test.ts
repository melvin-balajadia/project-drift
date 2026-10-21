import { describe, expect, it } from 'vitest';
import { detectComments } from '../../src/core/comments';

const js = (...lines: string[]) => detectComments(lines.join('\n'), 'typescript');
const py = (...lines: string[]) => detectComments(lines.join('\n'), 'python');
const starts = (blocks: { startLine: number }[]) => blocks.map((b) => b.startLine);

describe('detectComments', () => {
  it('detects JS/TS comments and strips markers', () => {
    expect(js('// Adds two', '///  numbers.', 'function add() {}')).toEqual([
      { startLine: 0, endLine: 1, indent: 0, text: 'Adds two\nnumbers.' },
    ]);
  });

  it('supports every JS/TS language id', () => {
    for (const id of ['javascript', 'javascriptreact', 'typescript', 'typescriptreact']) {
      expect(detectComments('// hi\nx();', id)).toHaveLength(1);
    }
  });

  it('detects Python comments', () => {
    expect(py('    ## Total', '    total = 1')).toEqual([
      { startLine: 0, endLine: 0, indent: 4, text: 'Total' },
    ]);
  });

  it('returns nothing for unsupported languages', () => {
    expect(detectComments('// hi\nx();', 'go')).toEqual([]);
  });

  it('splits blocks on blank lines and indentation changes', () => {
    expect(starts(js('// a', '', '// b', '  // c', 'x();'))).toEqual([0, 2, 3]);
  });

  it('ignores trailing inline comments', () => {
    expect(js('foo(); // note', 'bar();')).toEqual([]);
  });

  it('skips tool pragmas', () => {
    const pragmas = [
      '// eslint-disable-next-line no-console',
      '// @ts-ignore',
      '// @ts-expect-error',
      '// @ts-nocheck',
      '// prettier-ignore',
      '// istanbul ignore next',
      '/// <reference types="node" />',
      '// #region helpers',
    ];
    for (const p of pragmas) expect(js(p, 'x();'), p).toEqual([]);

    const pyPragmas = ['# type: ignore', '# noqa: E501', '# pylint: disable=foo', '# fmt: off'];
    for (const p of pyPragmas) expect(py(p, 'x = 1'), p).toEqual([]);
  });

  it('splits a block at a pragma line', () => {
    expect(js('// why', '// eslint-disable-next-line', 'x();')).toEqual([
      { startLine: 0, endLine: 0, indent: 0, text: 'why' },
    ]);
  });

  it('skips shebangs and encoding lines', () => {
    expect(py('#!/usr/bin/env python', '# -*- coding: utf-8 -*-', 'x = 1')).toEqual([]);
    expect(js('#!/usr/bin/env node', 'x();')).toEqual([]);
  });

  it('skips a license header at the top of the file', () => {
    expect(js('// Copyright 2024 Acme', '// MIT License', '', 'x();')).toEqual([]);
    expect(py('#!/usr/bin/env python', '# Licensed under MIT', 'x = 1')).toEqual([]);
  });

  it('keeps license-like comments that are not at the top', () => {
    expect(starts(js('x();', '// check the license', 'y();'))).toEqual([1]);
  });

  it('keeps non-license comments at the top of the file', () => {
    expect(starts(js('// Entry point.', 'main();'))).toEqual([0]);
  });

  it('skips blocks with no code after them', () => {
    expect(starts(js('// a', 'x();', '// trailing', '', '// also trailing'))).toEqual([0]);
  });

  it('handles CRLF', () => {
    expect(detectComments('// a\r\n// b\r\nx();\r\n', 'javascript')).toEqual([
      { startLine: 0, endLine: 1, indent: 0, text: 'a\nb' },
    ]);
  });
});
