// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

const {
    targetDir,
    tsconfigName,
    observableFromStreams,
    shouldRunInChildProcess,
    spawnGulpCommandInChildProcess,
} = require('./util');

const gulp = require('gulp');
const path = require('path');
const ts = require(`gulp-typescript`);
const sourcemaps = require('gulp-sourcemaps');
const { memoizeTask } = require('./memoize-task');
const {
    ReplaySubject,
    forkJoin: ObservableForkJoin,
} = require('rxjs');
const {
    mergeWith,
    takeLast,
    share
} = require('rxjs/operators');

const typescriptTask = ((cache) => memoizeTask(cache, function typescript(target, format) {
    if (shouldRunInChildProcess(target, format)) {
        return spawnGulpCommandInChildProcess('compile', target, format);
    }

    const out = targetDir(target, format);
    const tsconfigPath = path.join(`tsconfig`, `tsconfig.${tsconfigName(target, format)}.json`);
    return compileTypescript(out, tsconfigPath)
        .pipe(mergeWith(compileBinFiles(target, format)))
        .pipe(takeLast(1))
        .pipe(share({ connector: () => new ReplaySubject(), resetOnError: false, resetOnComplete: false, resetOnRefCountZero: false }))
}))({});

function compileBinFiles(target, format) {
    const out = targetDir(target, format);
    const tsconfigPath = path.join(`tsconfig`, `tsconfig.${tsconfigName('bin', 'cjs')}.json`);
    return compileTypescript(path.join(out, 'bin'), tsconfigPath, { target });
}

function compileTypescript(out, tsconfigPath, tsconfigOverrides) {
    const tsProject = ts.createProject(tsconfigPath, { typescript: require(`typescript`), ...tsconfigOverrides});
    const { stream: { js, dts } } = observableFromStreams(
      tsProject.src(), sourcemaps.init(),
      tsProject(ts.reporter.defaultReporter())
    );
    const writeSources = observableFromStreams(tsProject.src(), gulp.dest(path.join(out, 'src')));
    const writeDTypes = observableFromStreams(dts, sourcemaps.write('./', { includeContent: false, sourceRoot: 'src' }), gulp.dest(out));
    const mapFile = tsProject.options.module === 5 ? esmMapFile : cjsMapFile;
    const writeJS = observableFromStreams(js, sourcemaps.write('./', { mapFile, includeContent: false, sourceRoot: 'src' }), gulp.dest(out));
    return ObservableForkJoin([writeSources, writeDTypes, writeJS]);
}

const cjsMapFile = (mapFilePath) => mapFilePath;
const esmMapFile = (mapFilePath) => mapFilePath.replace('.js.map', '.mjs.map');

module.exports = typescriptTask;
module.exports.typescriptTask = typescriptTask;
module.exports.compileBinFiles = compileBinFiles;
