var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spread = (this && this.__spread) || function () {
    for (var ar = [], i = 0; i < arguments.length; i++) ar = ar.concat(__read(arguments[i]));
    return ar;
};
var __values = (this && this.__values) || function (o) {
    var m = typeof Symbol === "function" && o[Symbol.iterator], i = 0;
    if (m) return m.call(o);
    return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
};
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "fs", "path", "typescript", "../tsetse/runner", "./cache", "./compiler_host", "./diagnostics", "./manifest", "./perf_trace", "./strict_deps", "./tsconfig", "./worker"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var fs = require("fs");
    var path = require("path");
    var ts = require("typescript");
    var runner_1 = require("../tsetse/runner");
    var cache_1 = require("./cache");
    var compiler_host_1 = require("./compiler_host");
    var bazelDiagnostics = require("./diagnostics");
    var manifest_1 = require("./manifest");
    var perfTrace = require("./perf_trace");
    var strict_deps_1 = require("./strict_deps");
    var tsconfig_1 = require("./tsconfig");
    var worker_1 = require("./worker");
    /**
     * Top-level entry point for tsc_wrapped.
     */
    function main(args) {
        if (worker_1.runAsWorker(args)) {
            worker_1.log('Starting TypeScript compiler persistent worker...');
            worker_1.runWorkerLoop(runOneBuild);
            // Note: intentionally don't process.exit() here, because runWorkerLoop
            // is waiting for async callbacks from node.
        }
        else {
            worker_1.debug('Running a single build...');
            if (args.length === 0)
                throw new Error('Not enough arguments');
            if (!runOneBuild(args)) {
                return 1;
            }
        }
        return 0;
    }
    exports.main = main;
    /** The one ProgramAndFileCache instance used in this process. */
    var cache = new cache_1.ProgramAndFileCache(worker_1.debug);
    function isCompilationTarget(bazelOpts, sf) {
        return (bazelOpts.compilationTargetSrc.indexOf(sf.fileName) !== -1);
    }
    /**
     * Gather diagnostics from TypeScript's type-checker as well as other plugins we
     * install such as strict dependency checking.
     */
    function gatherDiagnostics(options, bazelOpts, program, disabledTsetseRules) {
        // Install extra diagnostic plugins
        if (!bazelOpts.disableStrictDeps) {
            var ignoredFilesPrefixes = [];
            if (bazelOpts.nodeModulesPrefix) {
                // Under Bazel, we exempt external files fetched from npm from strict
                // deps. This is because we allow users to implicitly depend on all the
                // node_modules.
                // TODO(alexeagle): if users opt-in to fine-grained npm dependencies, we
                // should be able to enforce strict deps for them.
                ignoredFilesPrefixes.push(bazelOpts.nodeModulesPrefix);
                if (options.rootDir) {
                    ignoredFilesPrefixes.push(path.resolve(options.rootDir, 'node_modules'));
                }
            }
            program = strict_deps_1.PLUGIN.wrap(program, __assign({}, bazelOpts, { rootDir: options.rootDir, ignoredFilesPrefixes: ignoredFilesPrefixes }));
        }
        if (!bazelOpts.isJsTranspilation) {
            var selectedTsetsePlugin = runner_1.PLUGIN;
            program = selectedTsetsePlugin.wrap(program, disabledTsetseRules);
        }
        // TODO(alexeagle): support plugins registered by config
        var diagnostics = [];
        perfTrace.wrap('type checking', function () {
            var e_1, _a;
            // These checks mirror ts.getPreEmitDiagnostics, with the important
            // exception of avoiding b/30708240, which is that if you call
            // program.getDeclarationDiagnostics() it somehow corrupts the emit.
            perfTrace.wrap("global diagnostics", function () {
                diagnostics.push.apply(diagnostics, __spread(program.getOptionsDiagnostics()));
                diagnostics.push.apply(diagnostics, __spread(program.getGlobalDiagnostics()));
            });
            var sourceFilesToCheck;
            if (bazelOpts.typeCheckDependencies) {
                sourceFilesToCheck = program.getSourceFiles();
            }
            else {
                sourceFilesToCheck = program.getSourceFiles().filter(function (f) { return isCompilationTarget(bazelOpts, f); });
            }
            var _loop_1 = function (sf) {
                perfTrace.wrap("check " + sf.fileName, function () {
                    diagnostics.push.apply(diagnostics, __spread(program.getSyntacticDiagnostics(sf)));
                    diagnostics.push.apply(diagnostics, __spread(program.getSemanticDiagnostics(sf)));
                });
                perfTrace.snapshotMemoryUsage();
            };
            try {
                for (var sourceFilesToCheck_1 = __values(sourceFilesToCheck), sourceFilesToCheck_1_1 = sourceFilesToCheck_1.next(); !sourceFilesToCheck_1_1.done; sourceFilesToCheck_1_1 = sourceFilesToCheck_1.next()) {
                    var sf = sourceFilesToCheck_1_1.value;
                    _loop_1(sf);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (sourceFilesToCheck_1_1 && !sourceFilesToCheck_1_1.done && (_a = sourceFilesToCheck_1.return)) _a.call(sourceFilesToCheck_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
        });
        return diagnostics;
    }
    exports.gatherDiagnostics = gatherDiagnostics;
    /**
     * Runs a single build, returning false on failure.  This is potentially called
     * multiple times (once per bazel request) when running as a bazel worker.
     * Any encountered errors are written to stderr.
     */
    function runOneBuild(args, inputs) {
        var e_2, _a;
        if (args.length !== 1) {
            console.error('Expected one argument: path to tsconfig.json');
            return false;
        }
        perfTrace.snapshotMemoryUsage();
        // Strip leading at-signs, used in build_defs.bzl to indicate a params file
        var tsconfigFile = args[0].replace(/^@+/, '');
        var _b = __read(tsconfig_1.parseTsconfig(tsconfigFile), 3), parsed = _b[0], errors = _b[1], target = _b[2].target;
        if (errors) {
            console.error(bazelDiagnostics.format(target, errors));
            return false;
        }
        if (!parsed) {
            throw new Error('Impossible state: if parseTsconfig returns no errors, then parsed should be non-null');
        }
        var options = parsed.options, bazelOpts = parsed.bazelOpts, files = parsed.files, disabledTsetseRules = parsed.disabledTsetseRules;
        if (bazelOpts.maxCacheSizeMb !== undefined) {
            var maxCacheSizeBytes = bazelOpts.maxCacheSizeMb * (1 << 20);
            cache.setMaxCacheSize(maxCacheSizeBytes);
        }
        else {
            cache.resetMaxCacheSize();
        }
        var fileLoader;
        if (inputs) {
            fileLoader = new cache_1.CachedFileLoader(cache);
            // Resolve the inputs to absolute paths to match TypeScript internals
            var resolvedInputs = new Map();
            try {
                for (var _c = __values(Object.keys(inputs)), _d = _c.next(); !_d.done; _d = _c.next()) {
                    var key = _d.value;
                    resolvedInputs.set(tsconfig_1.resolveNormalizedPath(key), inputs[key]);
                }
            }
            catch (e_2_1) { e_2 = { error: e_2_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
                }
                finally { if (e_2) throw e_2.error; }
            }
            cache.updateCache(resolvedInputs);
        }
        else {
            fileLoader = new cache_1.UncachedFileLoader();
        }
        var perfTracePath = bazelOpts.perfTracePath;
        if (!perfTracePath) {
            return runFromOptions(fileLoader, options, bazelOpts, files, disabledTsetseRules);
        }
        worker_1.log('Writing trace to', perfTracePath);
        var success = perfTrace.wrap('runOneBuild', function () { return runFromOptions(fileLoader, options, bazelOpts, files, disabledTsetseRules); });
        if (!success)
            return false;
        // Force a garbage collection pass.  This keeps our memory usage
        // consistent across multiple compilations, and allows the file
        // cache to use the current memory usage as a guideline for expiring
        // data.  Note: this is intentionally not within runFromOptions(), as
        // we want to gc only after all its locals have gone out of scope.
        global.gc();
        perfTrace.snapshotMemoryUsage();
        perfTrace.write(perfTracePath);
        return true;
    }
    // We only allow our own code to use the expected_diagnostics attribute
    var expectDiagnosticsWhitelist = [];
    function runFromOptions(fileLoader, options, bazelOpts, files, disabledTsetseRules) {
        perfTrace.snapshotMemoryUsage();
        cache.resetStats();
        cache.traceStats();
        var compilerHostDelegate = ts.createCompilerHost({ target: ts.ScriptTarget.ES5 });
        var moduleResolver = bazelOpts.isJsTranspilation ?
            makeJsModuleResolver(bazelOpts.workspaceName) :
            ts.resolveModuleName;
        var compilerHost = new compiler_host_1.CompilerHost(files, options, bazelOpts, compilerHostDelegate, fileLoader, moduleResolver);
        var oldProgram = cache.getProgram(bazelOpts.target);
        var program = perfTrace.wrap('createProgram', function () { return ts.createProgram(compilerHost.inputFiles, options, compilerHost, oldProgram); });
        cache.putProgram(bazelOpts.target, program);
        if (!bazelOpts.isJsTranspilation) {
            // If there are any TypeScript type errors abort now, so the error
            // messages refer to the original source.  After any subsequent passes
            // (decorator downleveling or tsickle) we do not type check.
            var diagnostics_1 = gatherDiagnostics(options, bazelOpts, program, disabledTsetseRules);
            if (!expectDiagnosticsWhitelist.length ||
                expectDiagnosticsWhitelist.some(function (p) { return bazelOpts.target.startsWith(p); })) {
                diagnostics_1 = bazelDiagnostics.filterExpected(bazelOpts, diagnostics_1, bazelDiagnostics.uglyFormat);
            }
            else if (bazelOpts.expectedDiagnostics.length > 0) {
                console.error("Only targets under " + expectDiagnosticsWhitelist.join(', ') + " can use " +
                    'expected_diagnostics, but got', bazelOpts.target);
            }
            if (diagnostics_1.length > 0) {
                console.error(bazelDiagnostics.format(bazelOpts.target, diagnostics_1));
                worker_1.debug('compilation failed at', new Error().stack);
                return false;
            }
        }
        var compilationTargets = program.getSourceFiles().filter(function (fileName) { return isCompilationTarget(bazelOpts, fileName); });
        var diagnostics = [];
        var useTsickleEmit = bazelOpts.tsickle;
        if (useTsickleEmit) {
            diagnostics = emitWithTsickle(program, compilerHost, compilationTargets, options, bazelOpts);
        }
        else {
            diagnostics = emitWithTypescript(program, compilationTargets);
        }
        if (diagnostics.length > 0) {
            console.error(bazelDiagnostics.format(bazelOpts.target, diagnostics));
            worker_1.debug('compilation failed at', new Error().stack);
            return false;
        }
        cache.printStats();
        return true;
    }
    function emitWithTypescript(program, compilationTargets) {
        var e_3, _a;
        var diagnostics = [];
        try {
            for (var compilationTargets_1 = __values(compilationTargets), compilationTargets_1_1 = compilationTargets_1.next(); !compilationTargets_1_1.done; compilationTargets_1_1 = compilationTargets_1.next()) {
                var sf = compilationTargets_1_1.value;
                var result = program.emit(sf);
                diagnostics.push.apply(diagnostics, __spread(result.diagnostics));
            }
        }
        catch (e_3_1) { e_3 = { error: e_3_1 }; }
        finally {
            try {
                if (compilationTargets_1_1 && !compilationTargets_1_1.done && (_a = compilationTargets_1.return)) _a.call(compilationTargets_1);
            }
            finally { if (e_3) throw e_3.error; }
        }
        return diagnostics;
    }
    function emitWithTsickle(program, compilerHost, compilationTargets, options, bazelOpts) {
        var e_4, _a;
        var emitResults = [];
        var diagnostics = [];
        // The 'tsickle' import above is only used in type positions, so it won't
        // result in a runtime dependency on tsickle.
        // If the user requests the tsickle emit, then we dynamically require it
        // here for use at runtime.
        var optTsickle;
        try {
            // tslint:disable-next-line:no-require-imports
            optTsickle = require('tsickle');
        }
        catch (e) {
            if (e.code !== 'MODULE_NOT_FOUND') {
                throw e;
            }
            throw new Error('When setting bazelOpts { tsickle: true }, ' +
                'you must also add a devDependency on the tsickle npm package');
        }
        perfTrace.wrap('emit', function () {
            var e_5, _a;
            var _loop_2 = function (sf) {
                perfTrace.wrap("emit " + sf.fileName, function () {
                    emitResults.push(optTsickle.emitWithTsickle(program, compilerHost, compilerHost, options, sf));
                });
            };
            try {
                for (var compilationTargets_3 = __values(compilationTargets), compilationTargets_3_1 = compilationTargets_3.next(); !compilationTargets_3_1.done; compilationTargets_3_1 = compilationTargets_3.next()) {
                    var sf = compilationTargets_3_1.value;
                    _loop_2(sf);
                }
            }
            catch (e_5_1) { e_5 = { error: e_5_1 }; }
            finally {
                try {
                    if (compilationTargets_3_1 && !compilationTargets_3_1.done && (_a = compilationTargets_3.return)) _a.call(compilationTargets_3);
                }
                finally { if (e_5) throw e_5.error; }
            }
        });
        var emitResult = optTsickle.mergeEmitResults(emitResults);
        diagnostics.push.apply(diagnostics, __spread(emitResult.diagnostics));
        // If tsickle reported diagnostics, don't produce externs or manifest outputs.
        if (diagnostics.length > 0) {
            return diagnostics;
        }
        var externs = '/** @externs */\n' +
            '// generating externs was disabled using generate_externs=False\n';
        if (bazelOpts.tsickleGenerateExterns) {
            externs =
                optTsickle.getGeneratedExterns(emitResult.externs, options.rootDir);
        }
        if (bazelOpts.tsickleExternsPath) {
            // Note: when tsickleExternsPath is provided, we always write a file as a
            // marker that compilation succeeded, even if it's empty (just containing an
            // @externs).
            fs.writeFileSync(bazelOpts.tsickleExternsPath, externs);
            // When generating externs, generate an externs file for each of the input
            // .d.ts files.
            if (bazelOpts.tsickleGenerateExterns &&
                compilerHost.provideExternalModuleDtsNamespace) {
                try {
                    for (var compilationTargets_2 = __values(compilationTargets), compilationTargets_2_1 = compilationTargets_2.next(); !compilationTargets_2_1.done; compilationTargets_2_1 = compilationTargets_2.next()) {
                        var extern = compilationTargets_2_1.value;
                        if (!extern.isDeclarationFile)
                            continue;
                        var outputBaseDir = options.outDir;
                        var relativeOutputPath = compilerHost.relativeOutputPath(extern.fileName);
                        mkdirp(outputBaseDir, path.dirname(relativeOutputPath));
                        var outputPath = path.join(outputBaseDir, relativeOutputPath);
                        var moduleName = compilerHost.pathToModuleName('', extern.fileName);
                        fs.writeFileSync(outputPath, "goog.module('" + moduleName + "');\n" +
                            "// Export an empty object of unknown type to allow imports.\n" +
                            "// TODO: use typeof once available\n" +
                            "exports = /** @type {?} */ ({});\n");
                    }
                }
                catch (e_4_1) { e_4 = { error: e_4_1 }; }
                finally {
                    try {
                        if (compilationTargets_2_1 && !compilationTargets_2_1.done && (_a = compilationTargets_2.return)) _a.call(compilationTargets_2);
                    }
                    finally { if (e_4) throw e_4.error; }
                }
            }
        }
        if (bazelOpts.manifest) {
            perfTrace.wrap('manifest', function () {
                var manifest = manifest_1.constructManifest(emitResult.modulesManifest, compilerHost);
                fs.writeFileSync(bazelOpts.manifest, manifest);
            });
        }
        return diagnostics;
    }
    /**
     * Creates directories subdir (a slash separated relative path) starting from
     * base.
     */
    function mkdirp(base, subdir) {
        var steps = subdir.split(path.sep);
        var current = base;
        for (var i = 0; i < steps.length; i++) {
            current = path.join(current, steps[i]);
            if (!fs.existsSync(current))
                fs.mkdirSync(current);
        }
    }
    /**
     * Resolve module filenames for JS modules.
     *
     * JS module resolution needs to be different because when transpiling JS we
     * do not pass in any dependencies, so the TS module resolver will not resolve
     * any files.
     *
     * Fortunately, JS module resolution is very simple. The imported module name
     * must either a relative path, or the workspace root (i.e. 'google3'),
     * so we can perform module resolution entirely based on file names, without
     * looking at the filesystem.
     */
    function makeJsModuleResolver(workspaceName) {
        // The literal '/' here is cross-platform safe because it's matching on
        // import specifiers, not file names.
        var workspaceModuleSpecifierPrefix = workspaceName + "/";
        var workspaceDir = "" + path.sep + workspaceName + path.sep;
        function jsModuleResolver(moduleName, containingFile, compilerOptions, host) {
            var resolvedFileName;
            if (containingFile === '') {
                // In tsickle we resolve the filename against '' to get the goog module
                // name of a sourcefile.
                resolvedFileName = moduleName;
            }
            else if (moduleName.startsWith(workspaceModuleSpecifierPrefix)) {
                // Given a workspace name of 'foo', we want to resolve import specifiers
                // like: 'foo/project/file.js' to the absolute filesystem path of
                // project/file.js within the workspace.
                var workspaceDirLocation = containingFile.indexOf(workspaceDir);
                if (workspaceDirLocation < 0) {
                    return { resolvedModule: undefined };
                }
                var absolutePathToWorkspaceDir = containingFile.slice(0, workspaceDirLocation);
                resolvedFileName = path.join(absolutePathToWorkspaceDir, moduleName);
            }
            else {
                if (!moduleName.startsWith('./') && !moduleName.startsWith('../')) {
                    throw new Error("Unsupported module import specifier: " + JSON.stringify(moduleName) + ".\n" +
                        "JS module imports must either be relative paths " +
                        "(beginning with '.' or '..'), " +
                        ("or they must begin with '" + workspaceName + "/'."));
                }
                resolvedFileName = path.join(path.dirname(containingFile), moduleName);
            }
            return {
                resolvedModule: {
                    resolvedFileName: resolvedFileName,
                    extension: ts.Extension.Js,
                    // These two fields are cargo culted from what ts.resolveModuleName
                    // seems to return.
                    packageId: undefined,
                    isExternalLibraryImport: false,
                }
            };
        }
        return jsModuleResolver;
    }
    if (require.main === module) {
        // Do not call process.exit(), as that terminates the binary before
        // completing pending operations, such as writing to stdout or emitting the
        // v8 performance log. Rather, set the exit code and fall off the main
        // thread, which will cause node to terminate cleanly.
        process.exitCode = main(process.argv.slice(2));
    }
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHNjX3dyYXBwZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9pbnRlcm5hbC90c2Nfd3JhcHBlZC90c2Nfd3JhcHBlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0lBQUEsdUJBQXlCO0lBQ3pCLDJCQUE2QjtJQUU3QiwrQkFBaUM7SUFFakMsMkNBQWtFO0lBRWxFLGlDQUE4RjtJQUM5RixpREFBNkM7SUFDN0MsZ0RBQWtEO0lBQ2xELHVDQUE2QztJQUM3Qyx3Q0FBMEM7SUFDMUMsNkNBQXlEO0lBQ3pELHVDQUE4RTtJQUM5RSxtQ0FBZ0U7SUFFaEU7O09BRUc7SUFDSCxTQUFnQixJQUFJLENBQUMsSUFBYztRQUNqQyxJQUFJLG9CQUFXLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDckIsWUFBRyxDQUFDLG1EQUFtRCxDQUFDLENBQUM7WUFDekQsc0JBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUMzQix1RUFBdUU7WUFDdkUsNENBQTRDO1NBQzdDO2FBQU07WUFDTCxjQUFLLENBQUMsMkJBQTJCLENBQUMsQ0FBQztZQUNuQyxJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDLENBQUM7WUFDL0QsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsRUFBRTtnQkFDdEIsT0FBTyxDQUFDLENBQUM7YUFDVjtTQUNGO1FBQ0QsT0FBTyxDQUFDLENBQUM7SUFDWCxDQUFDO0lBZEQsb0JBY0M7SUFFRCxpRUFBaUU7SUFDakUsSUFBTSxLQUFLLEdBQUcsSUFBSSwyQkFBbUIsQ0FBQyxjQUFLLENBQUMsQ0FBQztJQUU3QyxTQUFTLG1CQUFtQixDQUN4QixTQUF1QixFQUFFLEVBQWlCO1FBQzVDLE9BQU8sQ0FBQyxTQUFTLENBQUMsb0JBQW9CLENBQUMsT0FBTyxD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U0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsRUFBRTtvQkFDMUIsbUVBQW1FO29CQUNuRSxtQkFBbUI7b0JBQ25CLFNBQVMsRUFBRSxTQUFTO29CQUNwQix1QkFBdUIsRUFBRSxLQUFLO2lCQUMvQjthQUNGLENBQUM7UUFDSixDQUFDO1FBRUQsT0FBTyxnQkFBZ0IsQ0FBQztJQUMxQixDQUFDO0lBR0QsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRTtRQUMzQixtRUFBbUU7UUFDbkUsMkVBQTJFO1FBQzNFLHNFQUFzRTtRQUN0RSxzREFBc0Q7UUFDdEQsT0FBTyxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztLQUNoRCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyB0c2lja2xlIGZyb20gJ3RzaWNrbGUnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5cbmltcG9ydCB7UExVR0lOIGFzIGJhemVsQ29uZm9ybWFuY2VQbHVnaW59IGZyb20gJy4uL3RzZXRzZS9ydW5uZXInO1xuXG5pbXBvcnQge0NhY2hlZEZpbGVMb2FkZXIsIEZpbGVMb2FkZXIsIFByb2dyYW1BbmRGaWxlQ2FjaGUsIFVuY2FjaGVkRmlsZUxvYWRlcn0gZnJvbSAnLi9jYWNoZSc7XG5pbXBvcnQge0NvbXBpbGVySG9zdH0gZnJvbSAnLi9jb21waWxlcl9ob3N0JztcbmltcG9ydCAqIGFzIGJhemVsRGlhZ25vc3RpY3MgZnJvbSAnLi9kaWFnbm9zdGljcyc7XG5pbXBvcnQge2NvbnN0cnVjdE1hbmlmZXN0fSBmcm9tICcuL21hbmlmZXN0JztcbmltcG9ydCAqIGFzIHBlcmZUcmFjZSBmcm9tICcuL3BlcmZfdHJhY2UnO1xuaW1wb3J0IHtQTFVHSU4gYXMgc3RyaWN0RGVwc1BsdWdpbn0gZnJvbSAnLi9zdHJpY3RfZGVwcyc7XG5pbXBvcnQge0JhemVsT3B0aW9ucywgcGFyc2VUc2NvbmZpZywgcmVzb2x2ZU5vcm1hbGl6ZWRQYXRofSBmcm9tICcuL3RzY29uZmlnJztcbmltcG9ydCB7ZGVidWcsIGxvZywgcnVuQXNXb3JrZXIsIHJ1bldvcmtlckxvb3B9IGZyb20gJy4vd29ya2VyJztcblxuLyoqXG4gKiBUb3AtbGV2ZWwgZW50cnkgcG9pbnQgZm9yIHRzY193cmFwcGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFpbihhcmdzOiBzdHJpbmdbXSkge1xuICBpZiAocnVuQXNXb3JrZXIoYXJncykpIHtcbiAgICBsb2coJ1N0YXJ0aW5nIFR5cGVTY3JpcHQgY29tcGlsZXIgcGVyc2lzdGVudCB3b3JrZXIuLi4nKTtcbiAgICBydW5Xb3JrZXJMb29wKHJ1bk9uZUJ1aWxkKTtcbiAgICAvLyBOb3RlOiBpbnRlbnRpb25hbGx5IGRvbid0IHByb2Nlc3MuZXhpdCgpIGhlcmUsIGJlY2F1c2UgcnVuV29ya2VyTG9vcFxuICAgIC8vIGlzIHdhaXRpbmcgZm9yIGFzeW5jIGNhbGxiYWNrcyBmcm9tIG5vZGUuXG4gIH0gZWxzZSB7XG4gICAgZGVidWcoJ1J1bm5pbmcgYSBzaW5nbGUgYnVpbGQuLi4nKTtcbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcignTm90IGVub3VnaCBhcmd1bWVudHMnKTtcbiAgICBpZiAoIXJ1bk9uZUJ1aWxkKGFyZ3MpKSB7XG4gICAgICByZXR1cm4gMTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIDA7XG59XG5cbi8qKiBUaGUgb25lIFByb2dyYW1BbmRGaWxlQ2FjaGUgaW5zdGFuY2UgdXNlZCBpbiB0aGlzIHByb2Nlc3MuICovXG5jb25zdCBjYWNoZSA9IG5ldyBQcm9ncmFtQW5kRmlsZUNhY2hlKGRlYnVnKTtcblxuZnVuY3Rpb24gaXNDb21waWxhdGlvblRhcmdldChcbiAgICBiYXplbE9wdHM6IEJhemVsT3B0aW9ucywgc2Y6IHRzLlNvdXJjZUZpbGUpOiBib29sZWFuIHtcbiAgcmV0dXJuIChiYXplbE9wdHMuY29tcGlsYXRpb25UYXJnZXRTcmMuaW5kZXhPZihzZi5maWxlTmFtZSkgIT09IC0xKTtcbn1cblxuLyoqXG4gKiBHYXRoZXIgZGlhZ25vc3RpY3MgZnJvbSBUeXBlU2NyaXB0J3MgdHlwZS1jaGVja2VyIGFzIHdlbGwgYXMgb3RoZXIgcGx1Z2lucyB3ZVxuICogaW5zdGFsbCBzdWNoIGFzIHN0cmljdCBkZXBlbmRlbmN5IGNoZWNraW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2F0aGVyRGlhZ25vc3RpY3MoXG4gICAgb3B0aW9uczogdHMuQ29tcGlsZXJPcHRpb25zLCBiYXplbE9wdHM6IEJhemVsT3B0aW9ucywgcHJvZ3JhbTogdHMuUHJvZ3JhbSxcbiAgICBkaXNhYmxlZFRzZXRzZVJ1bGVzOiBzdHJpbmdbXSk6IHRzLkRpYWdub3N0aWNbXSB7XG4gIC8vIEluc3RhbGwgZXh0cmEgZGlhZ25vc3RpYyBwbHVnaW5zXG4gIGlmICghYmF6ZWxPcHRzLmRpc2FibGVTdHJpY3REZXBzKSB7XG4gICAgY29uc3QgaWdub3JlZEZpbGVzUHJlZml4ZXM6IHN0cmluZ1tdID0gW107XG4gICAgaWYgKGJhemVsT3B0cy5ub2RlTW9kdWxlc1ByZWZpeCkge1xuICAgICAgLy8gVW5kZXIgQmF6ZWwsIHdlIGV4ZW1wdCBleHRlcm5hbCBmaWxlcyBmZXRjaGVkIGZyb20gbnBtIGZyb20gc3RyaWN0XG4gICAgICAvLyBkZXBzLiBUaGlzIGlzIGJlY2F1c2Ugd2UgYWxsb3cgdXNlcnMgdG8gaW1wbGljaXRseSBkZXBlbmQgb24gYWxsIHRoZVxuICAgICAgLy8gbm9kZV9tb2R1bGVzLlxuICAgICAgLy8gVE9ETyhhbGV4ZWFnbGUpOiBpZiB1c2VycyBvcHQtaW4gdG8gZmluZS1ncmFpbmVkIG5wbSBkZXBlbmRlbmNpZXMsIHdlXG4gICAgICAvLyBzaG91bGQgYmUgYWJsZSB0byBlbmZvcmNlIHN0cmljdCBkZXBzIGZvciB0aGVtLlxuICAgICAgaWdub3JlZEZpbGVzUHJlZml4ZXMucHVzaChiYXplbE9wdHMubm9kZU1vZHVsZXNQcmVmaXgpO1xuICAgICAgaWYgKG9wdGlvbnMucm9vdERpcikge1xuICAgICAgICBpZ25vcmVkRmlsZXNQcmVmaXhlcy5wdXNoKFxuICAgICAgICAgICAgcGF0aC5yZXNvbHZlKG9wdGlvbnMucm9vdERpciEsICdub2RlX21vZHVsZXMnKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHByb2dyYW0gPSBzdHJpY3REZXBzUGx1Z2luLndyYXAocHJvZ3JhbSwge1xuICAgICAgLi4uYmF6ZWxPcHRzLFxuICAgICAgcm9vdERpcjogb3B0aW9ucy5yb290RGlyLFxuICAgICAgaWdub3JlZEZpbGVzUHJlZml4ZXMsXG4gICAgfSk7XG4gIH1cbiAgaWYgKCFiYXplbE9wdHMuaXNKc1RyYW5zcGlsYXRpb24pIHtcbiAgICBsZXQgc2VsZWN0ZWRUc2V0c2VQbHVnaW4gPSBiYXplbENvbmZvcm1hbmNlUGx1Z2luO1xuICAgIHByb2dyYW0gPSBzZWxlY3RlZFRzZXRzZVBsdWdpbi53cmFwKHByb2dyYW0sIGRpc2FibGVkVHNldHNlUnVsZXMpO1xuICB9XG5cbiAgLy8gVE9ETyhhbGV4ZWFnbGUpOiBzdXBwb3J0IHBsdWdpbnMgcmVnaXN0ZXJlZCBieSBjb25maWdcblxuICBjb25zdCBkaWFnbm9zdGljczogdHMuRGlhZ25vc3RpY1tdID0gW107XG4gIHBlcmZUcmFjZS53cmFwKCd0eXBlIGNoZWNraW5nJywgKCkgPT4ge1xuICAgIC8vIFRoZXNlIGNoZWNrcyBtaXJyb3IgdHMuZ2V0UHJlRW1pdERpYWdub3N0aWNzLCB3aXRoIHRoZSBpbXBvcnRhbnRcbiAgICAvLyBleGNlcHRpb24gb2YgYXZvaWRpbmcgYi8zMDcwODI0MCwgd2hpY2ggaXMgdGhhdCBpZiB5b3UgY2FsbFxuICAgIC8vIHByb2dyYW0uZ2V0RGVjbGFyYXRpb25EaWFnbm9zdGljcygpIGl0IHNvbWVob3cgY29ycnVwdHMgdGhlIGVtaXQuXG4gICAgcGVyZlRyYWNlLndyYXAoYGdsb2JhbCBkaWFnbm9zdGljc2AsICgpID0+IHtcbiAgICAgIGRpYWdub3N0aWNzLnB1c2goLi4ucHJvZ3JhbS5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSk7XG4gICAgICBkaWFnbm9zdGljcy5wdXNoKC4uLnByb2dyYW0uZ2V0R2xvYmFsRGlhZ25vc3RpY3MoKSk7XG4gICAgfSk7XG4gICAgbGV0IHNvdXJjZUZpbGVzVG9DaGVjazogUmVhZG9ubHlBcnJheTx0cy5Tb3VyY2VGaWxlPjtcbiAgICBpZiAoYmF6ZWxPcHRzLnR5cGVDaGVja0RlcGVuZGVuY2llcykge1xuICAgICAgc291cmNlRmlsZXNUb0NoZWNrID0gcHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzb3VyY2VGaWxlc1RvQ2hlY2sgPSBwcm9ncmFtLmdldFNvdXJjZUZpbGVzKCkuZmlsdGVyKFxuICAgICAgICAgIGYgPT4gaXNDb21waWxhdGlvblRhcmdldChiYXplbE9wdHMsIGYpKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBzZiBvZiBzb3VyY2VGaWxlc1RvQ2hlY2spIHtcbiAgICAgIHBlcmZUcmFjZS53cmFwKGBjaGVjayAke3NmLmZpbGVOYW1lfWAsICgpID0+IHtcbiAgICAgICAgZGlhZ25vc3RpY3MucHVzaCguLi5wcm9ncmFtLmdldFN5bnRhY3RpY0RpYWdub3N0aWNzKHNmKSk7XG4gICAgICAgIGRpYWdub3N0aWNzLnB1c2goLi4ucHJvZ3JhbS5nZXRTZW1hbnRpY0RpYWdub3N0aWNzKHNmKSk7XG4gICAgICB9KTtcbiAgICAgIHBlcmZUcmFjZS5zbmFwc2hvdE1lbW9yeVVzYWdlKCk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gZGlhZ25vc3RpY3M7XG59XG5cbi8qKlxuICogUnVucyBhIHNpbmdsZSBidWlsZCwgcmV0dXJuaW5nIGZhbHNlIG9uIGZhaWx1cmUuICBUaGlzIGlzIHBvdGVudGlhbGx5IGNhbGxlZFxuICogbXVsdGlwbGUgdGltZXMgKG9uY2UgcGVyIGJhemVsIHJlcXVlc3QpIHdoZW4gcnVubmluZyBhcyBhIGJhemVsIHdvcmtlci5cbiAqIEFueSBlbmNvdW50ZXJlZCBlcnJvcnMgYXJlIHdyaXR0ZW4gdG8gc3RkZXJyLlxuICovXG5mdW5jdGlvbiBydW5PbmVCdWlsZChcbiAgICBhcmdzOiBzdHJpbmdbXSwgaW5wdXRzPzoge1twYXRoOiBzdHJpbmddOiBzdHJpbmd9KTogYm9vbGVhbiB7XG4gIGlmIChhcmdzLmxlbmd0aCAhPT0gMSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0V4cGVjdGVkIG9uZSBhcmd1bWVudDogcGF0aCB0byB0c2NvbmZpZy5qc29uJyk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcGVyZlRyYWNlLnNuYXBzaG90TWVtb3J5VXNhZ2UoKTtcblxuICAvLyBTdHJpcCBsZWFkaW5nIGF0LXNpZ25zLCB1c2VkIGluIGJ1aWxkX2RlZnMuYnpsIHRvIGluZGljYXRlIGEgcGFyYW1zIGZpbGVcbiAgY29uc3QgdHNjb25maWdGaWxlID0gYXJnc1swXS5yZXBsYWNlKC9eQCsvLCAnJyk7XG4gIGNvbnN0IFtwYXJzZWQsIGVycm9ycywge3RhcmdldH1dID0gcGFyc2VUc2NvbmZpZyh0c2NvbmZpZ0ZpbGUpO1xuICBpZiAoZXJyb3JzKSB7XG4gICAgY29uc29sZS5lcnJvcihiYXplbERpYWdub3N0aWNzLmZvcm1hdCh0YXJnZXQsIGVycm9ycykpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoIXBhcnNlZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0ltcG9zc2libGUgc3RhdGU6IGlmIHBhcnNlVHNjb25maWcgcmV0dXJucyBubyBlcnJvcnMsIHRoZW4gcGFyc2VkIHNob3VsZCBiZSBub24tbnVsbCcpO1xuICB9XG4gIGNvbnN0IHtvcHRpb25zLCBiYXplbE9wdHMsIGZpbGVzLCBkaXNhYmxlZFRzZXRzZVJ1bGVzfSA9IHBhcnNlZDtcblxuICBpZiAoYmF6ZWxPcHRzLm1heENhY2hlU2l6ZU1iICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCBtYXhDYWNoZVNpemVCeXRlcyA9IGJhemVsT3B0cy5tYXhDYWNoZVNpemVNYiAqICgxIDw8IDIwKTtcbiAgICBjYWNoZS5zZXRNYXhDYWNoZVNpemUobWF4Q2FjaGVTaXplQnl0ZXMpO1xuICB9IGVsc2Uge1xuICAgIGNhY2hlLnJlc2V0TWF4Q2FjaGVTaXplKCk7XG4gIH1cblxuICBsZXQgZmlsZUxvYWRlcjogRmlsZUxvYWRlcjtcbiAgaWYgKGlucHV0cykge1xuICAgIGZpbGVMb2FkZXIgPSBuZXcgQ2FjaGVkRmlsZUxvYWRlcihjYWNoZSk7XG4gICAgLy8gUmVzb2x2ZSB0aGUgaW5wdXRzIHRvIGFic29sdXRlIHBhdGhzIHRvIG1hdGNoIFR5cGVTY3JpcHQgaW50ZXJuYWxzXG4gICAgY29uc3QgcmVzb2x2ZWRJbnB1dHMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGlucHV0cykpIHtcbiAgICAgIHJlc29sdmVkSW5wdXRzLnNldChyZXNvbHZlTm9ybWFsaXplZFBhdGgoa2V5KSwgaW5wdXRzW2tleV0pO1xuICAgIH1cbiAgICBjYWNoZS51cGRhdGVDYWNoZShyZXNvbHZlZElucHV0cyk7XG4gIH0gZWxzZSB7XG4gICAgZmlsZUxvYWRlciA9IG5ldyBVbmNhY2hlZEZpbGVMb2FkZXIoKTtcbiAgfVxuXG4gIGNvbnN0IHBlcmZUcmFjZVBhdGggPSBiYXplbE9wdHMucGVyZlRyYWNlUGF0aDtcbiAgaWYgKCFwZXJmVHJhY2VQYXRoKSB7XG4gICAgcmV0dXJuIHJ1bkZyb21PcHRpb25zKFxuICAgICAgICBmaWxlTG9hZGVyLCBvcHRpb25zLCBiYXplbE9wdHMsIGZpbGVzLCBkaXNhYmxlZFRzZXRzZVJ1bGVzKTtcbiAgfVxuXG4gIGxvZygnV3JpdGluZyB0cmFjZSB0bycsIHBlcmZUcmFjZVBhdGgpO1xuICBjb25zdCBzdWNjZXNzID0gcGVyZlRyYWNlLndyYXAoXG4gICAgICAncnVuT25lQnVpbGQnLFxuICAgICAgKCkgPT4gcnVuRnJvbU9wdGlvbnMoXG4gICAgICAgICAgZmlsZUxvYWRlciwgb3B0aW9ucywgYmF6ZWxPcHRzLCBmaWxlcywgZGlzYWJsZWRUc2V0c2VSdWxlcykpO1xuICBpZiAoIXN1Y2Nlc3MpIHJldHVybiBmYWxzZTtcbiAgLy8gRm9yY2UgYSBnYXJiYWdlIGNvbGxlY3Rpb24gcGFzcy4gIFRoaXMga2VlcHMgb3VyIG1lbW9yeSB1c2FnZVxuICAvLyBjb25zaXN0ZW50IGFjcm9zcyBtdWx0aXBsZSBjb21waWxhdGlvbnMsIGFuZCBhbGxvd3MgdGhlIGZpbGVcbiAgLy8gY2FjaGUgdG8gdXNlIHRoZSBjdXJyZW50IG1lbW9yeSB1c2FnZSBhcyBhIGd1aWRlbGluZSBmb3IgZXhwaXJpbmdcbiAgLy8gZGF0YS4gIE5vdGU6IHRoaXMgaXMgaW50ZW50aW9uYWxseSBub3Qgd2l0aGluIHJ1bkZyb21PcHRpb25zKCksIGFzXG4gIC8vIHdlIHdhbnQgdG8gZ2Mgb25seSBhZnRlciBhbGwgaXRzIGxvY2FscyBoYXZlIGdvbmUgb3V0IG9mIHNjb3BlLlxuICBnbG9iYWwuZ2MoKTtcblxuICBwZXJmVHJhY2Uuc25hcHNob3RNZW1vcnlVc2FnZSgpO1xuICBwZXJmVHJhY2Uud3JpdGUocGVyZlRyYWNlUGF0aCk7XG5cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFdlIG9ubHkgYWxsb3cgb3VyIG93biBjb2RlIHRvIHVzZSB0aGUgZXhwZWN0ZWRfZGlhZ25vc3RpY3MgYXR0cmlidXRlXG5jb25zdCBleHBlY3REaWFnbm9zdGljc1doaXRlbGlzdDogc3RyaW5nW10gPSBbXG5dO1xuXG5mdW5jdGlvbiBydW5Gcm9tT3B0aW9ucyhcbiAgICBmaWxlTG9hZGVyOiBGaWxlTG9hZGVyLCBvcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMsXG4gICAgYmF6ZWxPcHRzOiBCYXplbE9wdGlvbnMsIGZpbGVzOiBzdHJpbmdbXSxcbiAgICBkaXNhYmxlZFRzZXRzZVJ1bGVzOiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBwZXJmVHJhY2Uuc25hcHNob3RNZW1vcnlVc2FnZSgpO1xuICBjYWNoZS5yZXNldFN0YXRzKCk7XG4gIGNhY2hlLnRyYWNlU3RhdHMoKTtcbiAgY29uc3QgY29tcGlsZXJIb3N0RGVsZWdhdGUgPVxuICAgICAgdHMuY3JlYXRlQ29tcGlsZXJIb3N0KHt0YXJnZXQ6IHRzLlNjcmlwdFRhcmdldC5FUzV9KTtcblxuICBjb25zdCBtb2R1bGVSZXNvbHZlciA9IGJhemVsT3B0cy5pc0pzVHJhbnNwaWxhdGlvbiA/XG4gICAgICBtYWtlSnNNb2R1bGVSZXNvbHZlcihiYXplbE9wdHMud29ya3NwYWNlTmFtZSkgOlxuICAgICAgdHMucmVzb2x2ZU1vZHVsZU5hbWU7XG4gIGNvbnN0IGNvbXBpbGVySG9zdCA9IG5ldyBDb21waWxlckhvc3QoXG4gICAgICBmaWxlcywgb3B0aW9ucywgYmF6ZWxPcHRzLCBjb21waWxlckhvc3REZWxlZ2F0ZSwgZmlsZUxvYWRlcixcbiAgICAgIG1vZHVsZVJlc29sdmVyKTtcblxuXG4gIGNvbnN0IG9sZFByb2dyYW0gPSBjYWNoZS5nZXRQcm9ncmFtKGJhemVsT3B0cy50YXJnZXQpO1xuICBjb25zdCBwcm9ncmFtID0gcGVyZlRyYWNlLndyYXAoXG4gICAgICAnY3JlYXRlUHJvZ3JhbScsXG4gICAgICAoKSA9PiB0cy5jcmVhdGVQcm9ncmFtKFxuICAgICAgICAgIGNvbXBpbGVySG9zdC5pbnB1dEZpbGVzLCBvcHRpb25zLCBjb21waWxlckhvc3QsIG9sZFByb2dyYW0pKTtcbiAgY2FjaGUucHV0UHJvZ3JhbShiYXplbE9wdHMudGFyZ2V0LCBwcm9ncmFtKTtcblxuICBpZiAoIWJhemVsT3B0cy5pc0pzVHJhbnNwaWxhdGlvbikge1xuICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgVHlwZVNjcmlwdCB0eXBlIGVycm9ycyBhYm9ydCBub3csIHNvIHRoZSBlcnJvclxuICAgIC8vIG1lc3NhZ2VzIHJlZmVyIHRvIHRoZSBvcmlnaW5hbCBzb3VyY2UuICBBZnRlciBhbnkgc3Vic2VxdWVudCBwYXNzZXNcbiAgICAvLyAoZGVjb3JhdG9yIGRvd25sZXZlbGluZyBvciB0c2lja2xlKSB3ZSBkbyBub3QgdHlwZSBjaGVjay5cbiAgICBsZXQgZGlhZ25vc3RpY3MgPVxuICAgICAgICBnYXRoZXJEaWFnbm9zdGljcyhvcHRpb25zLCBiYXplbE9wdHMsIHByb2dyYW0sIGRpc2FibGVkVHNldHNlUnVsZXMpO1xuICAgIGlmICghZXhwZWN0RGlhZ25vc3RpY3NXaGl0ZWxpc3QubGVuZ3RoIHx8XG4gICAgICAgIGV4cGVjdERpYWdub3N0aWNzV2hpdGVsaXN0LnNvbWUocCA9PiBiYXplbE9wdHMudGFyZ2V0LnN0YXJ0c1dpdGgocCkpKSB7XG4gICAgICBkaWFnbm9zdGljcyA9IGJhemVsRGlhZ25vc3RpY3MuZmlsdGVyRXhwZWN0ZWQoXG4gICAgICAgICAgYmF6ZWxPcHRzLCBkaWFnbm9zdGljcywgYmF6ZWxEaWFnbm9zdGljcy51Z2x5Rm9ybWF0KTtcbiAgICB9IGVsc2UgaWYgKGJhemVsT3B0cy5leHBlY3RlZERpYWdub3N0aWNzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICAgYE9ubHkgdGFyZ2V0cyB1bmRlciAke1xuICAgICAgICAgICAgICBleHBlY3REaWFnbm9zdGljc1doaXRlbGlzdC5qb2luKCcsICcpfSBjYW4gdXNlIGAgK1xuICAgICAgICAgICAgICAnZXhwZWN0ZWRfZGlhZ25vc3RpY3MsIGJ1dCBnb3QnLFxuICAgICAgICAgIGJhemVsT3B0cy50YXJnZXQpO1xuICAgIH1cblxuICAgIGlmIChkaWFnbm9zdGljcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGJhemVsRGlhZ25vc3RpY3MuZm9ybWF0KGJhemVsT3B0cy50YXJnZXQsIGRpYWdub3N0aWNzKSk7XG4gICAgICBkZWJ1ZygnY29tcGlsYXRpb24gZmFpbGVkIGF0JywgbmV3IEVycm9yKCkuc3RhY2shKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBjb21waWxhdGlvblRhcmdldHMgPSBwcm9ncmFtLmdldFNvdXJjZUZpbGVzKCkuZmlsdGVyKFxuICAgICAgZmlsZU5hbWUgPT4gaXNDb21waWxhdGlvblRhcmdldChiYXplbE9wdHMsIGZpbGVOYW1lKSk7XG5cbiAgbGV0IGRpYWdub3N0aWNzOiB0cy5EaWFnbm9zdGljW10gPSBbXTtcbiAgbGV0IHVzZVRzaWNrbGVFbWl0ID0gYmF6ZWxPcHRzLnRzaWNrbGU7XG4gIGlmICh1c2VUc2lja2xlRW1pdCkge1xuICAgIGRpYWdub3N0aWNzID0gZW1pdFdpdGhUc2lja2xlKFxuICAgICAgICBwcm9ncmFtLCBjb21waWxlckhvc3QsIGNvbXBpbGF0aW9uVGFyZ2V0cywgb3B0aW9ucywgYmF6ZWxPcHRzKTtcbiAgfSBlbHNlIHtcbiAgICBkaWFnbm9zdGljcyA9IGVtaXRXaXRoVHlwZXNjcmlwdChwcm9ncmFtLCBjb21waWxhdGlvblRhcmdldHMpO1xuICB9XG5cbiAgaWYgKGRpYWdub3N0aWNzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zb2xlLmVycm9yKGJhemVsRGlhZ25vc3RpY3MuZm9ybWF0KGJhemVsT3B0cy50YXJnZXQsIGRpYWdub3N0aWNzKSk7XG4gICAgZGVidWcoJ2NvbXBpbGF0aW9uIGZhaWxlZCBhdCcsIG5ldyBFcnJvcigpLnN0YWNrISk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY2FjaGUucHJpbnRTdGF0cygpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gZW1pdFdpdGhUeXBlc2NyaXB0KFxuICAgIHByb2dyYW06IHRzLlByb2dyYW0sIGNvbXBpbGF0aW9uVGFyZ2V0czogdHMuU291cmNlRmlsZVtdKTogdHMuRGlhZ25vc3RpY1tdIHtcbiAgY29uc3QgZGlhZ25vc3RpY3M6IHRzLkRpYWdub3N0aWNbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNmIG9mIGNvbXBpbGF0aW9uVGFyZ2V0cykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHByb2dyYW0uZW1pdChzZik7XG4gICAgZGlhZ25vc3RpY3MucHVzaCguLi5yZXN1bHQuZGlhZ25vc3RpY3MpO1xuICB9XG4gIHJldHVybiBkaWFnbm9zdGljcztcbn1cblxuZnVuY3Rpb24gZW1pdFdpdGhUc2lja2xlKFxuICAgIHByb2dyYW06IHRzLlByb2dyYW0sIGNvbXBpbGVySG9zdDogQ29tcGlsZXJIb3N0LFxuICAgIGNvbXBpbGF0aW9uVGFyZ2V0czogdHMuU291cmNlRmlsZVtdLCBvcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMsXG4gICAgYmF6ZWxPcHRzOiBCYXplbE9wdGlvbnMpOiB0cy5EaWFnbm9zdGljW10ge1xuICBjb25zdCBlbWl0UmVzdWx0czogdHNpY2tsZS5FbWl0UmVzdWx0W10gPSBbXTtcbiAgY29uc3QgZGlhZ25vc3RpY3M6IHRzLkRpYWdub3N0aWNbXSA9IFtdO1xuICAvLyBUaGUgJ3RzaWNrbGUnIGltcG9ydCBhYm92ZSBpcyBvbmx5IHVzZWQgaW4gdHlwZSBwb3NpdGlvbnMsIHNvIGl0IHdvbid0XG4gIC8vIHJlc3VsdCBpbiBhIHJ1bnRpbWUgZGVwZW5kZW5jeSBvbiB0c2lja2xlLlxuICAvLyBJZiB0aGUgdXNlciByZXF1ZXN0cyB0aGUgdHNpY2tsZSBlbWl0LCB0aGVuIHdlIGR5bmFtaWNhbGx5IHJlcXVpcmUgaXRcbiAgLy8gaGVyZSBmb3IgdXNlIGF0IHJ1bnRpbWUuXG4gIGxldCBvcHRUc2lja2xlOiB0eXBlb2YgdHNpY2tsZTtcbiAgdHJ5IHtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tcmVxdWlyZS1pbXBvcnRzXG4gICAgb3B0VHNpY2tsZSA9IHJlcXVpcmUoJ3RzaWNrbGUnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChlLmNvZGUgIT09ICdNT0RVTEVfTk9UX0ZPVU5EJykge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnV2hlbiBzZXR0aW5nIGJhemVsT3B0cyB7IHRzaWNrbGU6IHRydWUgfSwgJyArXG4gICAgICAgICd5b3UgbXVzdCBhbHNvIGFkZCBhIGRldkRlcGVuZGVuY3kgb24gdGhlIHRzaWNrbGUgbnBtIHBhY2thZ2UnKTtcbiAgfVxuICBwZXJmVHJhY2Uud3JhcCgnZW1pdCcsICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IHNmIG9mIGNvbXBpbGF0aW9uVGFyZ2V0cykge1xuICAgICAgcGVyZlRyYWNlLndyYXAoYGVtaXQgJHtzZi5maWxlTmFtZX1gLCAoKSA9PiB7XG4gICAgICAgIGVtaXRSZXN1bHRzLnB1c2gob3B0VHNpY2tsZS5lbWl0V2l0aFRzaWNrbGUoXG4gICAgICAgICAgICBwcm9ncmFtLCBjb21waWxlckhvc3QsIGNvbXBpbGVySG9zdCwgb3B0aW9ucywgc2YpKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG4gIGNvbnN0IGVtaXRSZXN1bHQgPSBvcHRUc2lja2xlLm1lcmdlRW1pdFJlc3VsdHMoZW1pdFJlc3VsdHMpO1xuICBkaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuXG4gIC8vIElmIHRzaWNrbGUgcmVwb3J0ZWQgZGlhZ25vc3RpY3MsIGRvbid0IHByb2R1Y2UgZXh0ZXJucyBvciBtYW5pZmVzdCBvdXRwdXRzLlxuICBpZiAoZGlhZ25vc3RpY3MubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBkaWFnbm9zdGljcztcbiAgfVxuXG4gIGxldCBleHRlcm5zID0gJy8qKiBAZXh0ZXJucyAqL1xcbicgK1xuICAgICAgJy8vIGdlbmVyYXRpbmcgZXh0ZXJucyB3YXMgZGlzYWJsZWQgdXNpbmcgZ2VuZXJhdGVfZXh0ZXJucz1GYWxzZVxcbic7XG4gIGlmIChiYXplbE9wdHMudHNpY2tsZUdlbmVyYXRlRXh0ZXJucykge1xuICAgIGV4dGVybnMgPVxuICAgICAgICBvcHRUc2lja2xlLmdldEdlbmVyYXRlZEV4dGVybnMoZW1pdFJlc3VsdC5leHRlcm5zLCBvcHRpb25zLnJvb3REaXIhKTtcbiAgfVxuXG4gIGlmIChiYXplbE9wdHMudHNpY2tsZUV4dGVybnNQYXRoKSB7XG4gICAgLy8gTm90ZTogd2hlbiB0c2lja2xlRXh0ZXJuc1BhdGggaXMgcHJvdmlkZWQsIHdlIGFsd2F5cyB3cml0ZSBhIGZpbGUgYXMgYVxuICAgIC8vIG1hcmtlciB0aGF0IGNvbXBpbGF0aW9uIHN1Y2NlZWRlZCwgZXZlbiBpZiBpdCdzIGVtcHR5IChqdXN0IGNvbnRhaW5pbmcgYW5cbiAgICAvLyBAZXh0ZXJucykuXG4gICAgZnMud3JpdGVGaWxlU3luYyhiYXplbE9wdHMudHNpY2tsZUV4dGVybnNQYXRoLCBleHRlcm5zKTtcblxuICAgIC8vIFdoZW4gZ2VuZXJhdGluZyBleHRlcm5zLCBnZW5lcmF0ZSBhbiBleHRlcm5zIGZpbGUgZm9yIGVhY2ggb2YgdGhlIGlucHV0XG4gICAgLy8gLmQudHMgZmlsZXMuXG4gICAgaWYgKGJhemVsT3B0cy50c2lja2xlR2VuZXJhdGVFeHRlcm5zICYmXG4gICAgICAgIGNvbXBpbGVySG9zdC5wcm92aWRlRXh0ZXJuYWxNb2R1bGVEdHNOYW1lc3BhY2UpIHtcbiAgICAgIGZvciAoY29uc3QgZXh0ZXJuIG9mIGNvbXBpbGF0aW9uVGFyZ2V0cykge1xuICAgICAgICBpZiAoIWV4dGVybi5pc0RlY2xhcmF0aW9uRmlsZSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IG91dHB1dEJhc2VEaXIgPSBvcHRpb25zLm91dERpciE7XG4gICAgICAgIGNvbnN0IHJlbGF0aXZlT3V0cHV0UGF0aCA9XG4gICAgICAgICAgICBjb21waWxlckhvc3QucmVsYXRpdmVPdXRwdXRQYXRoKGV4dGVybi5maWxlTmFtZSk7XG4gICAgICAgIG1rZGlycChvdXRwdXRCYXNlRGlyLCBwYXRoLmRpcm5hbWUocmVsYXRpdmVPdXRwdXRQYXRoKSk7XG4gICAgICAgIGNvbnN0IG91dHB1dFBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZURpciwgcmVsYXRpdmVPdXRwdXRQYXRoKTtcbiAgICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IGNvbXBpbGVySG9zdC5wYXRoVG9Nb2R1bGVOYW1lKCcnLCBleHRlcm4uZmlsZU5hbWUpO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKFxuICAgICAgICAgICAgb3V0cHV0UGF0aCxcbiAgICAgICAgICAgIGBnb29nLm1vZHVsZSgnJHttb2R1bGVOYW1lfScpO1xcbmAgK1xuICAgICAgICAgICAgICAgIGAvLyBFeHBvcnQgYW4gZW1wdHkgb2JqZWN0IG9mIHVua25vd24gdHlwZSB0byBhbGxvdyBpbXBvcnRzLlxcbmAgK1xuICAgICAgICAgICAgICAgIGAvLyBUT0RPOiB1c2UgdHlwZW9mIG9uY2UgYXZhaWxhYmxlXFxuYCArXG4gICAgICAgICAgICAgICAgYGV4cG9ydHMgPSAvKiogQHR5cGUgez99ICovICh7fSk7XFxuYCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKGJhemVsT3B0cy5tYW5pZmVzdCkge1xuICAgIHBlcmZUcmFjZS53cmFwKCdtYW5pZmVzdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID1cbiAgICAgICAgICBjb25zdHJ1Y3RNYW5pZmVzdChlbWl0UmVzdWx0Lm1vZHVsZXNNYW5pZmVzdCwgY29tcGlsZXJIb3N0KTtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmMoYmF6ZWxPcHRzLm1hbmlmZXN0LCBtYW5pZmVzdCk7XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gZGlhZ25vc3RpY3M7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBkaXJlY3RvcmllcyBzdWJkaXIgKGEgc2xhc2ggc2VwYXJhdGVkIHJlbGF0aXZlIHBhdGgpIHN0YXJ0aW5nIGZyb21cbiAqIGJhc2UuXG4gKi9cbmZ1bmN0aW9uIG1rZGlycChiYXNlOiBzdHJpbmcsIHN1YmRpcjogc3RyaW5nKSB7XG4gIGNvbnN0IHN0ZXBzID0gc3ViZGlyLnNwbGl0KHBhdGguc2VwKTtcbiAgbGV0IGN1cnJlbnQgPSBiYXNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHN0ZXBzLmxlbmd0aDsgaSsrKSB7XG4gICAgY3VycmVudCA9IHBhdGguam9pbihjdXJyZW50LCBzdGVwc1tpXSk7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKGN1cnJlbnQpKSBmcy5ta2RpclN5bmMoY3VycmVudCk7XG4gIH1cbn1cblxuXG4vKipcbiAqIFJlc29sdmUgbW9kdWxlIGZpbGVuYW1lcyBmb3IgSlMgbW9kdWxlcy5cbiAqXG4gKiBKUyBtb2R1bGUgcmVzb2x1dGlvbiBuZWVkcyB0byBiZSBkaWZmZXJlbnQgYmVjYXVzZSB3aGVuIHRyYW5zcGlsaW5nIEpTIHdlXG4gKiBkbyBub3QgcGFzcyBpbiBhbnkgZGVwZW5kZW5jaWVzLCBzbyB0aGUgVFMgbW9kdWxlIHJlc29sdmVyIHdpbGwgbm90IHJlc29sdmVcbiAqIGFueSBmaWxlcy5cbiAqXG4gKiBGb3J0dW5hdGVseSwgSlMgbW9kdWxlIHJlc29sdXRpb24gaXMgdmVyeSBzaW1wbGUuIFRoZSBpbXBvcnRlZCBtb2R1bGUgbmFtZVxuICogbXVzdCBlaXRoZXIgYSByZWxhdGl2ZSBwYXRoLCBvciB0aGUgd29ya3NwYWNlIHJvb3QgKGkuZS4gJ2dvb2dsZTMnKSxcbiAqIHNvIHdlIGNhbiBwZXJmb3JtIG1vZHVsZSByZXNvbHV0aW9uIGVudGlyZWx5IGJhc2VkIG9uIGZpbGUgbmFtZXMsIHdpdGhvdXRcbiAqIGxvb2tpbmcgYXQgdGhlIGZpbGVzeXN0ZW0uXG4gKi9cbmZ1bmN0aW9uIG1ha2VKc01vZHVsZVJlc29sdmVyKHdvcmtzcGFjZU5hbWU6IHN0cmluZykge1xuICAvLyBUaGUgbGl0ZXJhbCAnLycgaGVyZSBpcyBjcm9zcy1wbGF0Zm9ybSBzYWZlIGJlY2F1c2UgaXQncyBtYXRjaGluZyBvblxuICAvLyBpbXBvcnQgc3BlY2lmaWVycywgbm90IGZpbGUgbmFtZXMuXG4gIGNvbnN0IHdvcmtzcGFjZU1vZHVsZVNwZWNpZmllclByZWZpeCA9IGAke3dvcmtzcGFjZU5hbWV9L2A7XG4gIGNvbnN0IHdvcmtzcGFjZURpciA9IGAke3BhdGguc2VwfSR7d29ya3NwYWNlTmFtZX0ke3BhdGguc2VwfWA7XG4gIGZ1bmN0aW9uIGpzTW9kdWxlUmVzb2x2ZXIoXG4gICAgICBtb2R1bGVOYW1lOiBzdHJpbmcsIGNvbnRhaW5pbmdGaWxlOiBzdHJpbmcsXG4gICAgICBjb21waWxlck9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucywgaG9zdDogdHMuTW9kdWxlUmVzb2x1dGlvbkhvc3QpOlxuICAgICAgdHMuUmVzb2x2ZWRNb2R1bGVXaXRoRmFpbGVkTG9va3VwTG9jYXRpb25zIHtcbiAgICBsZXQgcmVzb2x2ZWRGaWxlTmFtZTtcbiAgICBpZiAoY29udGFpbmluZ0ZpbGUgPT09ICcnKSB7XG4gICAgICAvLyBJbiB0c2lja2xlIHdlIHJlc29sdmUgdGhlIGZpbGVuYW1lIGFnYWluc3QgJycgdG8gZ2V0IHRoZSBnb29nIG1vZHVsZVxuICAgICAgLy8gbmFtZSBvZiBhIHNvdXJjZWZpbGUuXG4gICAgICByZXNvbHZlZEZpbGVOYW1lID0gbW9kdWxlTmFtZTtcbiAgICB9IGVsc2UgaWYgKG1vZHVsZU5hbWUuc3RhcnRzV2l0aCh3b3Jrc3BhY2VNb2R1bGVTcGVjaWZpZXJQcmVmaXgpKSB7XG4gICAgICAvLyBHaXZlbiBhIHdvcmtzcGFjZSBuYW1lIG9mICdmb28nLCB3ZSB3YW50IHRvIHJlc29sdmUgaW1wb3J0IHNwZWNpZmllcnNcbiAgICAgIC8vIGxpa2U6ICdmb28vcHJvamVjdC9maWxlLmpzJyB0byB0aGUgYWJzb2x1dGUgZmlsZXN5c3RlbSBwYXRoIG9mXG4gICAgICAvLyBwcm9qZWN0L2ZpbGUuanMgd2l0aGluIHRoZSB3b3Jrc3BhY2UuXG4gICAgICBjb25zdCB3b3Jrc3BhY2VEaXJMb2NhdGlvbiA9IGNvbnRhaW5pbmdGaWxlLmluZGV4T2Yod29ya3NwYWNlRGlyKTtcbiAgICAgIGlmICh3b3Jrc3BhY2VEaXJMb2NhdGlvbiA8IDApIHtcbiAgICAgICAgcmV0dXJuIHtyZXNvbHZlZE1vZHVsZTogdW5kZWZpbmVkfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aFRvV29ya3NwYWNlRGlyID1cbiAgICAgICAgICBjb250YWluaW5nRmlsZS5zbGljZSgwLCB3b3Jrc3BhY2VEaXJMb2NhdGlvbik7XG4gICAgICByZXNvbHZlZEZpbGVOYW1lID0gcGF0aC5qb2luKGFic29sdXRlUGF0aFRvV29ya3NwYWNlRGlyLCBtb2R1bGVOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFtb2R1bGVOYW1lLnN0YXJ0c1dpdGgoJy4vJykgJiYgIW1vZHVsZU5hbWUuc3RhcnRzV2l0aCgnLi4vJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgYFVuc3VwcG9ydGVkIG1vZHVsZSBpbXBvcnQgc3BlY2lmaWVyOiAke1xuICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KG1vZHVsZU5hbWUpfS5cXG5gICtcbiAgICAgICAgICAgIGBKUyBtb2R1bGUgaW1wb3J0cyBtdXN0IGVpdGhlciBiZSByZWxhdGl2ZSBwYXRocyBgICtcbiAgICAgICAgICAgIGAoYmVnaW5uaW5nIHdpdGggJy4nIG9yICcuLicpLCBgICtcbiAgICAgICAgICAgIGBvciB0aGV5IG11c3QgYmVnaW4gd2l0aCAnJHt3b3Jrc3BhY2VOYW1lfS8nLmApO1xuICAgICAgfVxuICAgICAgcmVzb2x2ZWRGaWxlTmFtZSA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUoY29udGFpbmluZ0ZpbGUpLCBtb2R1bGVOYW1lKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlc29sdmVkTW9kdWxlOiB7XG4gICAgICAgIHJlc29sdmVkRmlsZU5hbWUsXG4gICAgICAgIGV4dGVuc2lvbjogdHMuRXh0ZW5zaW9uLkpzLCAgLy8ganMgY2FuIG9ubHkgaW1wb3J0IGpzXG4gICAgICAgIC8vIFRoZXNlIHR3byBmaWVsZHMgYXJlIGNhcmdvIGN1bHRlZCBmcm9tIHdoYXQgdHMucmVzb2x2ZU1vZHVsZU5hbWVcbiAgICAgICAgLy8gc2VlbXMgdG8gcmV0dXJuLlxuICAgICAgICBwYWNrYWdlSWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgaXNFeHRlcm5hbExpYnJhcnlJbXBvcnQ6IGZhbHNlLFxuICAgICAgfVxuICAgIH07XG4gIH1cblxuICByZXR1cm4ganNNb2R1bGVSZXNvbHZlcjtcbn1cblxuXG5pZiAocmVxdWlyZS5tYWluID09PSBtb2R1bGUpIHtcbiAgLy8gRG8gbm90IGNhbGwgcHJvY2Vzcy5leGl0KCksIGFzIHRoYXQgdGVybWluYXRlcyB0aGUgYmluYXJ5IGJlZm9yZVxuICAvLyBjb21wbGV0aW5nIHBlbmRpbmcgb3BlcmF0aW9ucywgc3VjaCBhcyB3cml0aW5nIHRvIHN0ZG91dCBvciBlbWl0dGluZyB0aGVcbiAgLy8gdjggcGVyZm9ybWFuY2UgbG9nLiBSYXRoZXIsIHNldCB0aGUgZXhpdCBjb2RlIGFuZCBmYWxsIG9mZiB0aGUgbWFpblxuICAvLyB0aHJlYWQsIHdoaWNoIHdpbGwgY2F1c2Ugbm9kZSB0byB0ZXJtaW5hdGUgY2xlYW5seS5cbiAgcHJvY2Vzcy5leGl0Q29kZSA9IG1haW4ocHJvY2Vzcy5hcmd2LnNsaWNlKDIpKTtcbn1cbiJdfQ==