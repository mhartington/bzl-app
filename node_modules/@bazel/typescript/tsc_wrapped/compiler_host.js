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
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "fs", "path", "typescript", "./perf_trace", "./worker"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var fs = require("fs");
    var path = require("path");
    var ts = require("typescript");
    var perfTrace = require("./perf_trace");
    var worker_1 = require("./worker");
    function narrowTsOptions(options) {
        if (!options.rootDirs) {
            throw new Error("compilerOptions.rootDirs should be set by tsconfig.bzl");
        }
        if (!options.rootDir) {
            throw new Error("compilerOptions.rootDirs should be set by tsconfig.bzl");
        }
        if (!options.outDir) {
            throw new Error("compilerOptions.rootDirs should be set by tsconfig.bzl");
        }
        return options;
    }
    exports.narrowTsOptions = narrowTsOptions;
    function validateBazelOptions(bazelOpts) {
        if (!bazelOpts.isJsTranspilation)
            return;
        if (bazelOpts.compilationTargetSrc &&
            bazelOpts.compilationTargetSrc.length > 1) {
            throw new Error("In JS transpilation mode, only one file can appear in " +
                "bazelOptions.compilationTargetSrc.");
        }
        if (!bazelOpts.transpiledJsOutputFileName) {
            throw new Error("In JS transpilation mode, transpiledJsOutputFileName " +
                "must be specified in tsconfig.");
        }
    }
    var SOURCE_EXT = /((\.d)?\.tsx?|\.js)$/;
    /**
     * CompilerHost that knows how to cache parsed files to improve compile times.
     */
    var CompilerHost = /** @class */ (function () {
        function CompilerHost(inputFiles, options, bazelOpts, delegate, fileLoader, moduleResolver) {
            if (moduleResolver === void 0) { moduleResolver = ts.resolveModuleName; }
            var _this = this;
            this.inputFiles = inputFiles;
            this.bazelOpts = bazelOpts;
            this.delegate = delegate;
            this.fileLoader = fileLoader;
            this.moduleResolver = moduleResolver;
            /**
             * Lookup table to answer file stat's without looking on disk.
             */
            this.knownFiles = new Set();
            this.moduleResolutionHost = this;
            // TODO(evanm): delete this once tsickle is updated.
            this.host = this;
            this.allowActionInputReads = true;
            this.options = narrowTsOptions(options);
            this.relativeRoots =
                this.options.rootDirs.map(function (r) { return path.relative(_this.options.rootDir, r); });
            inputFiles.forEach(function (f) {
                _this.knownFiles.add(f);
            });
            // getCancelationToken is an optional method on the delegate. If we
            // unconditionally implement the method, we will be forced to return null,
            // in the absense of the delegate method. That won't match the return type.
            // Instead, we optionally set a function to a field with the same name.
            if (delegate && delegate.getCancellationToken) {
                this.getCancelationToken = delegate.getCancellationToken.bind(delegate);
            }
            // Override directoryExists so that TypeScript can automatically
            // include global typings from node_modules/@types
            // see getAutomaticTypeDirectiveNames in
            // TypeScript:src/compiler/moduleNameResolver
            if (this.allowActionInputReads && delegate && delegate.directoryExists) {
                this.directoryExists = delegate.directoryExists.bind(delegate);
            }
            validateBazelOptions(bazelOpts);
            this.googmodule = bazelOpts.googmodule;
            this.es5Mode = bazelOpts.es5Mode;
            this.prelude = bazelOpts.prelude;
            this.untyped = bazelOpts.untyped;
            this.typeBlackListPaths = new Set(bazelOpts.typeBlackListPaths);
            this.transformDecorators = bazelOpts.tsickle;
            this.transformTypesToClosure = bazelOpts.tsickle;
            this.addDtsClutzAliases = bazelOpts.addDtsClutzAliases;
            this.isJsTranspilation = Boolean(bazelOpts.isJsTranspilation);
            this.provideExternalModuleDtsNamespace = !bazelOpts.hasImplementation;
        }
        /**
         * For the given potentially absolute input file path (typically .ts), returns
         * the relative output path. For example, for
         * /path/to/root/blaze-out/k8-fastbuild/genfiles/my/file.ts, will return
         * my/file.js or my/file.closure.js (depending on ES5 mode).
         */
        CompilerHost.prototype.relativeOutputPath = function (fileName) {
            var result = this.rootDirsRelative(fileName);
            result = result.replace(/(\.d)?\.[jt]sx?$/, '');
            if (!this.bazelOpts.es5Mode)
                result += '.closure';
            return result + '.js';
        };
        /**
         * Workaround https://github.com/Microsoft/TypeScript/issues/8245
         * We use the `rootDirs` property both for module resolution,
         * and *also* to flatten the structure of the output directory
         * (as `rootDir` would do for a single root).
         * To do this, look for the pattern outDir/relativeRoots[i]/path/to/file
         * or relativeRoots[i]/path/to/file
         * and replace that with path/to/file
         */
        CompilerHost.prototype.flattenOutDir = function (fileName) {
            var e_1, _a;
            var result = fileName;
            // outDir/relativeRoots[i]/path/to/file -> relativeRoots[i]/path/to/file
            if (fileName.startsWith(this.options.rootDir)) {
                result = path.relative(this.options.outDir, fileName);
            }
            try {
                for (var _b = __values(this.relativeRoots), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var dir = _c.value;
                    // relativeRoots[i]/path/to/file -> path/to/file
                    var rel = path.relative(dir, result);
                    if (!rel.startsWith('..')) {
                        result = rel;
                        // relativeRoots is sorted longest first so we can short-circuit
                        // after the first match
                        break;
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_1) throw e_1.error; }
            }
            return result;
        };
        /** Avoid using tsickle on files that aren't in srcs[] */
        CompilerHost.prototype.shouldSkipTsickleProcessing = function (fileName) {
            return this.bazelOpts.isJsTranspilation ||
                this.bazelOpts.compilationTargetSrc.indexOf(fileName) === -1;
        };
        /** Whether the file is expected to be imported using a named module */
        CompilerHost.prototype.shouldNameModule = function (fileName) {
            return this.bazelOpts.compilationTargetSrc.indexOf(fileName) !== -1;
        };
        /** Allows suppressing warnings for specific known libraries */
        CompilerHost.prototype.shouldIgnoreWarningsForPath = function (filePath) {
            return this.bazelOpts.ignoreWarningPaths.some(function (p) { return !!filePath.match(new RegExp(p)); });
        };
        /**
         * fileNameToModuleId gives the module ID for an input source file name.
         * @param fileName an input source file name, e.g.
         *     /root/dir/bazel-out/host/bin/my/file.ts.
         * @return the canonical path of a file within blaze, without /genfiles/ or
         *     /bin/ path parts, excluding a file extension. For example, "my/file".
         */
        CompilerHost.prototype.fileNameToModuleId = function (fileName) {
            return this.relativeOutputPath(fileName.substring(0, fileName.lastIndexOf('.')));
        };
        /**
         * TypeScript SourceFile's have a path with the rootDirs[i] still present, eg.
         * /build/work/bazel-out/local-fastbuild/bin/path/to/file
         * @return the path without any rootDirs, eg. path/to/file
         */
        CompilerHost.prototype.rootDirsRelative = function (fileName) {
            var e_2, _a;
            try {
                for (var _b = __values(this.options.rootDirs), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var root = _c.value;
                    if (fileName.startsWith(root)) {
                        // rootDirs are sorted longest-first, so short-circuit the iteration
                        // see tsconfig.ts.
                        return path.posix.relative(root, fileName);
                    }
                }
            }
            catch (e_2_1) { e_2 = { error: e_2_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_2) throw e_2.error; }
            }
            return fileName;
        };
        /**
         * Massages file names into valid goog.module names:
         * - resolves relative paths to the given context
         * - resolves non-relative paths which takes module_root into account
         * - replaces '/' with '.' in the '<workspace>' namespace
         * - replace first char if non-alpha
         * - replace subsequent non-alpha numeric chars
         */
        CompilerHost.prototype.pathToModuleName = function (context, importPath) {
            // tsickle hands us an output path, we need to map it back to a source
            // path in order to do module resolution with it.
            // outDir/relativeRoots[i]/path/to/file ->
            // rootDir/relativeRoots[i]/path/to/file
            if (context.startsWith(this.options.outDir)) {
                context = path.join(this.options.rootDir, path.relative(this.options.outDir, context));
            }
            // Try to get the resolved path name from TS compiler host which can
            // handle resolution for libraries with module_root like rxjs and @angular.
            var resolvedPath = null;
            var resolved = this.moduleResolver(importPath, context, this.options, this);
            if (resolved && resolved.resolvedModule &&
                resolved.resolvedModule.resolvedFileName) {
                resolvedPath = resolved.resolvedModule.resolvedFileName;
                // /build/work/bazel-out/local-fastbuild/bin/path/to/file ->
                // path/to/file
                resolvedPath = this.rootDirsRelative(resolvedPath);
            }
            else {
                // importPath can be an absolute file path in google3.
                // Try to trim it as a path relative to bin and genfiles, and if so,
                // handle its file extension in the block below and prepend the workspace
                // name.
                var trimmed = this.rootDirsRelative(importPath);
                if (trimmed !== importPath) {
                    resolvedPath = trimmed;
                }
            }
            if (resolvedPath) {
                // Strip file extensions.
                importPath = resolvedPath.replace(SOURCE_EXT, '');
                // Make sure all module names include the workspace name.
                if (importPath.indexOf(this.bazelOpts.workspaceName) !== 0) {
                    importPath = path.posix.join(this.bazelOpts.workspaceName, importPath);
                }
            }
            // Remove the __{LOCALE} from the module name.
            if (this.bazelOpts.locale) {
                var suffix = '__' + this.bazelOpts.locale.toLowerCase();
                if (importPath.toLowerCase().endsWith(suffix)) {
                    importPath = importPath.substring(0, importPath.length - suffix.length);
                }
            }
            // Replace characters not supported by goog.module and '.' with
            // '$<Hex char code>' so that the original module name can be re-obtained
            // without any loss.
            // See goog.VALID_MODULE_RE_ in Closure's base.js for characters supported
            // by google.module.
            var escape = function (c) {
                return '$' + c.charCodeAt(0).toString(16);
            };
            var moduleName = importPath.replace(/^[^a-zA-Z_/]/, escape)
                .replace(/[^a-zA-Z_0-9_/]/g, escape)
                .replace(/\//g, '.');
            return moduleName;
        };
        /**
         * Converts file path into a valid AMD module name.
         *
         * An AMD module can have an arbitrary name, so that it is require'd by name
         * rather than by path. See http://requirejs.org/docs/whyamd.html#namedmodules
         *
         * "However, tools that combine multiple modules together for performance need
         *  a way to give names to each module in the optimized file. For that, AMD
         *  allows a string as the first argument to define()"
         */
        CompilerHost.prototype.amdModuleName = function (sf) {
            if (!this.shouldNameModule(sf.fileName))
                return undefined;
            // /build/work/bazel-out/local-fastbuild/bin/path/to/file.ts
            // -> path/to/file
            var fileName = this.rootDirsRelative(sf.fileName).replace(SOURCE_EXT, '');
            var workspace = this.bazelOpts.workspaceName;
            // Workaround https://github.com/bazelbuild/bazel/issues/1262
            //
            // When the file comes from an external bazel repository,
            // and TypeScript resolves runfiles symlinks, then the path will look like
            // output_base/execroot/local_repo/external/another_repo/foo/bar
            // We want to name such a module "another_repo/foo/bar" just as it would be
            // named by code in that repository.
            // As a workaround, check for the /external/ path segment, and fix up the
            // workspace name to be the name of the external repository.
            if (fileName.startsWith('external/')) {
                var parts = fileName.split('/');
                workspace = parts[1];
                fileName = parts.slice(2).join('/');
            }
            if (this.bazelOpts.moduleName) {
                var relativeFileName = path.posix.relative(this.bazelOpts.package, fileName);
                if (!relativeFileName.startsWith('..')) {
                    if (this.bazelOpts.moduleRoot &&
                        this.bazelOpts.moduleRoot.replace(SOURCE_EXT, '') ===
                            relativeFileName) {
                        return this.bazelOpts.moduleName;
                    }
                    // Support the common case of commonjs convention that index is the
                    // default module in a directory.
                    // This makes our module naming scheme more conventional and lets users
                    // refer to modules with the natural name they're used to.
                    if (relativeFileName === 'index') {
                        return this.bazelOpts.moduleName;
                    }
                    return path.posix.join(this.bazelOpts.moduleName, relativeFileName);
                }
            }
            // path/to/file ->
            // myWorkspace/path/to/file
            return path.posix.join(workspace, fileName);
        };
        /**
         * Resolves the typings file from a package at the specified path. Helper
         * function to `resolveTypeReferenceDirectives`.
         */
        CompilerHost.prototype.resolveTypingFromDirectory = function (typePath, primary) {
            // Looks for the `typings` attribute in a package.json file
            // if it exists
            var pkgFile = path.posix.join(typePath, 'package.json');
            if (this.fileExists(pkgFile)) {
                var pkg = JSON.parse(fs.readFileSync(pkgFile, 'UTF-8'));
                var typings = pkg['typings'];
                if (typings) {
                    if (typings === '.' || typings === './') {
                        typings = 'index.d.ts';
                    }
                    var maybe_1 = path.posix.join(typePath, typings);
                    if (this.fileExists(maybe_1)) {
                        return { primary: primary, resolvedFileName: maybe_1 };
                    }
                }
            }
            // Look for an index.d.ts file in the path
            var maybe = path.posix.join(typePath, 'index.d.ts');
            if (this.fileExists(maybe)) {
                return { primary: primary, resolvedFileName: maybe };
            }
            return undefined;
        };
        /**
         * Override the default typescript resolveTypeReferenceDirectives function.
         * Resolves /// <reference types="x" /> directives under bazel. The default
         * typescript secondary search behavior needs to be overridden to support
         * looking under `bazelOpts.nodeModulesPrefix`
         */
        CompilerHost.prototype.resolveTypeReferenceDirectives = function (names, containingFile) {
            var _this = this;
            if (!this.allowActionInputReads)
                return [];
            var result = [];
            names.forEach(function (name) {
                var resolved;
                // primary search
                _this.options.typeRoots.forEach(function (typeRoot) {
                    if (!resolved) {
                        resolved = _this.resolveTypingFromDirectory(path.posix.join(typeRoot, name), true);
                    }
                });
                // secondary search
                if (!resolved) {
                    resolved = _this.resolveTypingFromDirectory(path.posix.join(_this.bazelOpts.nodeModulesPrefix, name), false);
                }
                // Types not resolved should be silently ignored. Leave it to Typescript
                // to either error out with "TS2688: Cannot find type definition file for
                // 'foo'" or for the build to fail due to a missing type that is used.
                if (!resolved) {
                    if (worker_1.DEBUG) {
                        worker_1.debug("Failed to resolve type reference directive '" + name + "'");
                    }
                    return;
                }
                // In typescript 2.x the return type for this function
                // is `(ts.ResolvedTypeReferenceDirective | undefined)[]` thus we actually
                // do allow returning `undefined` in the array but the function is typed
                // `(ts.ResolvedTypeReferenceDirective)[]` to compile with both typescript
                // 2.x and 3.0/3.1 without error. Typescript 3.0/3.1 do handle the `undefined`
                // values in the array correctly despite the return signature.
                // It looks like the return type change was a mistake because
                // it was changed back to include `| undefined` recently:
                // https://github.com/Microsoft/TypeScript/pull/28059.
                result.push(resolved);
            });
            return result;
        };
        /** Loads a source file from disk (or the cache). */
        CompilerHost.prototype.getSourceFile = function (fileName, languageVersion, onError) {
            var _this = this;
            return perfTrace.wrap("getSourceFile " + fileName, function () {
                var sf = _this.fileLoader.loadFile(fileName, fileName, languageVersion);
                if (!/\.d\.tsx?$/.test(fileName) &&
                    (_this.options.module === ts.ModuleKind.AMD ||
                        _this.options.module === ts.ModuleKind.UMD)) {
                    var moduleName = _this.amdModuleName(sf);
                    if (sf.moduleName === moduleName || !moduleName)
                        return sf;
                    if (sf.moduleName) {
                        throw new Error("ERROR: " + sf.fileName + " " +
                            ("contains a module name declaration " + sf.moduleName + " ") +
                            ("which would be overwritten with " + moduleName + " ") +
                            "by Bazel's TypeScript compiler.");
                    }
                    // Setting the moduleName is equivalent to the original source having a
                    // ///<amd-module name="some/name"/> directive
                    sf.moduleName = moduleName;
                }
                return sf;
            });
        };
        CompilerHost.prototype.writeFile = function (fileName, content, writeByteOrderMark, onError, sourceFiles) {
            var _this = this;
            perfTrace.wrap("writeFile " + fileName, function () { return _this.writeFileImpl(fileName, content, writeByteOrderMark, onError, sourceFiles); });
        };
        CompilerHost.prototype.writeFileImpl = function (fileName, content, writeByteOrderMark, onError, sourceFiles) {
            // Workaround https://github.com/Microsoft/TypeScript/issues/18648
            // This bug is fixed in TS 2.9
            var version = ts.versionMajorMinor;
            var _a = __read(version.split('.').map(function (s) { return Number(s); }), 2), major = _a[0], minor = _a[1];
            var workaroundNeeded = major <= 2 && minor <= 8;
            if (workaroundNeeded &&
                (this.options.module === ts.ModuleKind.AMD ||
                    this.options.module === ts.ModuleKind.UMD) &&
                fileName.endsWith('.d.ts') && sourceFiles && sourceFiles.length > 0 &&
                sourceFiles[0].moduleName) {
                content =
                    "/// <amd-module name=\"" + sourceFiles[0].moduleName + "\" />\n" + content;
            }
            fileName = this.flattenOutDir(fileName);
            if (this.bazelOpts.isJsTranspilation) {
                fileName = this.bazelOpts.transpiledJsOutputFileName;
            }
            else if (!this.bazelOpts.es5Mode) {
                // Write ES6 transpiled files to *.closure.js.
                if (this.bazelOpts.locale) {
                    // i18n paths are required to end with __locale.js so we put
                    // the .closure segment before the __locale
                    fileName = fileName.replace(/(__[^\.]+)?\.js$/, '.closure$1.js');
                }
                else {
                    fileName = fileName.replace(/\.js$/, '.closure.js');
                }
            }
            // Prepend the output directory.
            fileName = path.join(this.options.outDir, fileName);
            // Our file cache is based on mtime - so avoid writing files if they
            // did not change.
            if (!fs.existsSync(fileName) ||
                fs.readFileSync(fileName, 'utf-8') !== content) {
                this.delegate.writeFile(fileName, content, writeByteOrderMark, onError, sourceFiles);
            }
        };
        /**
         * Performance optimization: don't try to stat files we weren't explicitly
         * given as inputs.
         * This also allows us to disable Bazel sandboxing, without accidentally
         * reading .ts inputs when .d.ts inputs are intended.
         * Note that in worker mode, the file cache will also guard against arbitrary
         * file reads.
         */
        CompilerHost.prototype.fileExists = function (filePath) {
            // Under Bazel, users do not declare deps[] on their node_modules.
            // This means that we do not list all the needed .d.ts files in the files[]
            // section of tsconfig.json, and that is what populates the knownFiles set.
            // In addition, the node module resolver may need to read package.json files
            // and these are not permitted in the files[] section.
            // So we permit reading node_modules/* from action inputs, even though this
            // can include data[] dependencies and is broader than we would like.
            // This should only be enabled under Bazel, not Blaze.
            if (this.allowActionInputReads && filePath.indexOf('/node_modules/') >= 0) {
                var result = this.fileLoader.fileExists(filePath);
                if (worker_1.DEBUG && !result && this.delegate.fileExists(filePath)) {
                    worker_1.debug("Path exists, but is not registered in the cache", filePath);
                    Object.keys(this.fileLoader.cache.lastDigests).forEach(function (k) {
                        if (k.endsWith(path.basename(filePath))) {
                            worker_1.debug("  Maybe you meant to load from", k);
                        }
                    });
                }
                return result;
            }
            return this.knownFiles.has(filePath);
        };
        CompilerHost.prototype.getDefaultLibLocation = function () {
            // Since we override getDefaultLibFileName below, we must also provide the
            // directory containing the file.
            // Otherwise TypeScript looks in C:\lib.xxx.d.ts for the default lib.
            return path.dirname(this.getDefaultLibFileName({ target: ts.ScriptTarget.ES5 }));
        };
        CompilerHost.prototype.getDefaultLibFileName = function (options) {
            if (this.bazelOpts.nodeModulesPrefix) {
                return path.join(this.bazelOpts.nodeModulesPrefix, 'typescript/lib', ts.getDefaultLibFileName({ target: ts.ScriptTarget.ES5 }));
            }
            return this.delegate.getDefaultLibFileName(options);
        };
        CompilerHost.prototype.realpath = function (s) {
            // tsc-wrapped relies on string matching of file paths for things like the
            // file cache and for strict deps checking.
            // TypeScript will try to resolve symlinks during module resolution which
            // makes our checks fail: the path we resolved as an input isn't the same
            // one the module resolver will look for.
            // See https://github.com/Microsoft/TypeScript/pull/12020
            // So we simply turn off symlink resolution.
            return s;
        };
        // Delegate everything else to the original compiler host.
        CompilerHost.prototype.getCanonicalFileName = function (path) {
            return this.delegate.getCanonicalFileName(path);
        };
        CompilerHost.prototype.getCurrentDirectory = function () {
            return this.delegate.getCurrentDirectory();
        };
        CompilerHost.prototype.useCaseSensitiveFileNames = function () {
            return this.delegate.useCaseSensitiveFileNames();
        };
        CompilerHost.prototype.getNewLine = function () {
            return this.delegate.getNewLine();
        };
        CompilerHost.prototype.getDirectories = function (path) {
            return this.delegate.getDirectories(path);
        };
        CompilerHost.prototype.readFile = function (fileName) {
            return this.delegate.readFile(fileName);
        };
        CompilerHost.prototype.trace = function (s) {
            console.error(s);
        };
        return CompilerHost;
    }());
    exports.CompilerHost = CompilerHost;
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcGlsZXJfaG9zdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL2ludGVybmFsL3RzY193cmFwcGVkL2NvbXBpbGVyX2hvc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztJQUFBLHVCQUF5QjtJQUN6QiwyQkFBNkI7SUFFN0IsK0JBQWlDO0lBR2pDLHdDQUEwQztJQUUxQyxtQ0FBc0M7SUFrQnRDLFNBQWdCLGVBQWUsQ0FBQyxPQUEyQjtRQUN6RCxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRTtZQUNyQixNQUFNLElBQUksS0FBSyxDQUFDLHdEQUF3RCxDQUFDLENBQUM7U0FDM0U7UUFDRCxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRTtZQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLHdEQUF3RCxDQUFDLENBQUM7U0FDM0U7UUFDRCxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRTtZQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLHdEQUF3RCxDQUFDLENBQUM7U0FDM0U7UUFDRCxPQUFPLE9BQXlCLENBQUM7SUFDbkMsQ0FBQztJQVhELDBDQVdDO0lBRUQsU0FBUyxvQkFBb0IsQ0FBQyxTQUF1QjtRQUNuRCxJQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQjtZQUFFLE9BQU87UUFFekMsSUFBSSxTQUFTLENBQUMsb0JBQW9CO1lBQzlCLFNBQVMsQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQzdDLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdEO2dCQUN4RCxvQ0FBb0MsQ0FBQyxDQUFDO1NBQ3ZEO1FBRUQsSUFBSSxDQUFDLFNBQVMsQ0FBQywwQkFBMEIsRUFBRTtZQUN6QyxNQUFNLElBQUksS0FBSyxDQUFDLHVEQUF1RDtnQkFDdkQsZ0NBQWdDLENBQUMsQ0FBQztTQUNuRDtJQUNILENBQUM7SUFFRCxJQUFNLFVBQVUsR0FBRyxzQkFBc0IsQ0FBQztJQUUxQzs7T0FFRztJQUNIO1FBK0JFLHNCQUNXLFVBQW9CLEVBQUUsT0FBMkIsRUFDL0MsU0FBdUIsRUFBVSxRQUF5QixFQUMzRCxVQUFzQixFQUN0QixjQUFxRDtZQUFyRCwrQkFBQSxFQUFBLGlCQUFpQyxFQUFFLENBQUMsaUJBQWlCO1lBSmpFLGlCQXVDQztZQXRDVSxlQUFVLEdBQVYsVUFBVSxDQUFVO1lBQ2xCLGNBQVMsR0FBVCxTQUFTLENBQWM7WUFBVSxhQUFRLEdBQVIsUUFBUSxDQUFpQjtZQUMzRCxlQUFVLEdBQVYsVUFBVSxDQUFZO1lBQ3RCLG1CQUFjLEdBQWQsY0FBYyxDQUF1QztZQWxDakU7O2VBRUc7WUFDSyxlQUFVLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztZQXFCdkMseUJBQW9CLEdBQTRCLElBQUksQ0FBQztZQUNyRCxvREFBb0Q7WUFDcEQsU0FBSSxHQUE0QixJQUFJLENBQUM7WUFDN0IsMEJBQXFCLEdBQUcsSUFBSSxDQUFDO1lBUW5DLElBQUksQ0FBQyxPQUFPLEdBQUcsZUFBZSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3hDLElBQUksQ0FBQyxhQUFhO2dCQUNkLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxVQUFBLENBQUMsSUFBSSxPQUFBLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLEVBQXRDLENBQXNDLENBQUMsQ0FBQztZQUMzRSxVQUFVLENBQUMsT0FBTyxDQUFDLFVBQUMsQ0FBQztnQkFDbkIsS0FBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDekIsQ0FBQyxDQUFDLENBQUM7WUFFSCxtRUFBbUU7WUFDbkUsMEVBQTBFO1lBQzFFLDJFQUEyRTtZQUMzRSx1RUFBdUU7WUFDdkUsSUFBSSxRQUFRLElBQUksUUFBUSxDQUFDLG9CQUFvQixFQUFFO2dCQUM3QyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsUUFBUSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQzthQUN6RTtZQUVELGdFQUFnRTtZQUNoRSxrREFBa0Q7WUFDbEQsd0NBQXdDO1lBQ3hDLDZDQUE2QztZQUM3QyxJQUFJLElBQUksQ0FBQyxxQkFBcUIsSUFBSSxRQUFRLElBQUksUUFBUSxDQUFDLGVBQWUsRUFBRTtnQkFDdEUsSUFBSSxDQUFDLGVBQWUsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQzthQUNoRTtZQUVELG9CQUFvQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ2hDLElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFDLFVBQVUsQ0FBQztZQUN2QyxJQUFJLENBQUMsT0FBTyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUM7WUFDakMsSUFBSSxDQUFDLE9BQU8sR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDO1lBQ2pDLElBQUksQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQztZQUNqQyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDaEUsSUFBSSxDQUFDLG1CQUFtQixHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUM7WUFDN0MsSUFBSSxDQUFDLHVCQUF1QixHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUM7WUFDakQsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQztZQUN2RCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQzlELElBQUksQ0FBQyxpQ0FBaUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQztRQUN4RSxDQUFDO1FBRUQ7Ozs7O1dBS0c7UUFDSCx5Q0FBa0IsR0FBbEIsVUFBbUIsUUFBZ0I7WUFDakMsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQzdDLE1BQU0sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLGtCQUFrQixFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU87Z0JBQUUsTUFBTSxJQUFJLFVBQVUsQ0FBQztZQUNsRCxPQUFPLE1BQU0sR0FBRyxLQUFLLENBQUM7UUFDeEIsQ0FBQztRQUVEOzs7Ozs7OztXQVFHO1FBQ0gsb0NBQWEsR0FBYixVQUFjLFFBQWdCOztZQUM1QixJQUFJLE1BQU0sR0FBRyxRQUFRLENBQUM7WUFFdEIsd0VBQXdFO1lBQ3hFLElBQUksUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFO2dCQUM3QyxNQUFNLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQzthQUN2RDs7Z0JBRUQsS0FBa0IsSUFBQSxLQUFBLFNBQUEsSUFBSSxDQUFDLGFBQWEsQ0FBQSxnQkFBQSw0QkFBRTtvQkFBakMsSUFBTSxHQUFHLFdBQUE7b0JBQ1osZ0RBQWdEO29CQUNoRCxJQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQztvQkFDdkMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUU7d0JBQ3pCLE1BQU0sR0FBRyxHQUFHLENBQUM7d0JBQ2IsZ0VBQWdFO3dCQUNoRSx3QkFBd0I7d0JBQ3hCLE1BQU07cUJBQ1A7aUJBQ0Y7Ozs7Ozs7OztZQUNELE9BQU8sTUFBTSxDQUFDO1FBQ2hCLENBQUM7UUFFRCx5REFBeUQ7UUFDekQsa0RBQTJCLEdBQTNCLFVBQTRCLFFBQWdCO1lBQzFDLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxpQkFBaUI7Z0JBQ2hDLElBQUksQ0FBQyxTQUFTLENBQUMsb0JBQW9CLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7UUFFRCx1RUFBdUU7UUFDdkUsdUNBQWdCLEdBQWhCLFVBQWlCLFFBQWdCO1lBQy9CLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDdEUsQ0FBQztRQUVELCtEQUErRDtRQUMvRCxrREFBMkIsR0FBM0IsVUFBNEIsUUFBZ0I7WUFDMUMsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FDekMsVUFBQSxDQUFDLElBQUksT0FBQSxDQUFDLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUEvQixDQUErQixDQUFDLENBQUM7UUFDNUMsQ0FBQztRQUVEOzs7Ozs7V0FNRztRQUNILHlDQUFrQixHQUFsQixVQUFtQixRQUFnQjtZQUNqQyxPQUFPLElBQUksQ0FBQyxrQkFBa0IsQ0FDMUIsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDeEQsQ0FBQztRQUVEOzs7O1dBSUc7UUFDSyx1Q0FBZ0IsR0FBeEIsVUFBeUIsUUFBZ0I7OztnQkFDdkMsS0FBbUIsSUFBQSxLQUFBLFNBQUEsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUEsZ0JBQUEsNEJBQUU7b0JBQXJDLElBQU0sSUFBSSxXQUFBO29CQUNiLElBQUksUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBRTt3QkFDN0Isb0VBQW9FO3dCQUNwRSxtQkFBbUI7d0JBQ25CLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO3FCQUM1QztpQkFDRjs7Ozs7Ozs7O1lBQ0QsT0FBTyxRQUFRLENBQUM7UUFDbEIsQ0FBQztRQUVEOzs7Ozs7O1dBT0c7UUFDSCx1Q0FBZ0IsR0FBaEIsVUFBaUIsT0FBZSxFQUFFLFVBQWtCO1lBQ2xELHNFQUFzRTtZQUN0RSxpREFBaUQ7WUFDakQsMENBQTBDO1lBQzFDLHdDQUF3QztZQUN4QyxJQUFJLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRTtnQkFDM0MsT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQ2YsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO2FBQ3hFO1lBRUQsb0VBQW9FO1lBQ3BFLDJFQUEyRTtZQUMzRSxJQUFJLFlBQVksR0FBZ0IsSUFBSSxDQUFDO1lBQ3JDLElBQU0sUUFBUSxHQUNWLElBQUksQ0FBQyxjQUFjLENBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQ2pFLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxjQUFjO2dCQUNuQyxRQUFRLENBQUMsY0FBYyxDQUFDLGdCQUFnQixFQUFFO2dCQUM1QyxZQUFZLEdBQUcsUUFBUSxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQztnQkFDeEQsNERBQTREO2dCQUM1RCxlQUFlO2dCQUNmLFlBQVksR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxDQUFDLENBQUM7YUFDcEQ7aUJBQU07Z0JBQ0wsc0RBQXNEO2dCQUN0RCxvRUFBb0U7Z0JBQ3BFLHlFQUF5RTtnQkFDekUsUUFBUTtnQkFDUixJQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxDQUFDLENBQUM7Z0JBQ2xELElBQUksT0FBTyxLQUFLLFVBQVUsRUFBRTtvQkFDMUIsWUFBWSxHQUFHLE9BQU8sQ0FBQztpQkFDeEI7YUFDRjtZQUNELElBQUksWUFBWSxFQUFFO2dCQUNoQix5QkFBeUI7Z0JBQ3pCLFVBQVUsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDbEQseURBQXlEO2dCQUN6RCxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLEVBQUU7b0JBQzFELFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsRUFBRSxVQUFVLENBQUMsQ0FBQztpQkFDeEU7YUFDRjtZQUVELDhDQUE4QztZQUM5QyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFO2dCQUN6QixJQUFNLE1BQU0sR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUM7Z0JBQzFELElBQUksVUFBVSxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsRUFBRTtvQkFDN0MsVUFBVSxHQUFHLFVBQVUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLFVBQVUsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2lCQUN6RTthQUNGO1lBRUQsK0RBQStEO1lBQy9ELHlFQUF5RTtZQUN6RSxvQkFBb0I7WUFDcEIsMEVBQTBFO1lBQzFFLG9CQUFvQjtZQUVwQixJQUFNLE1BQU0sR0FBRyxVQUFDLENBQVM7Z0JBQ3ZCLE9BQU8sR0FBRyxHQUFHLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQzVDLENBQUMsQ0FBQztZQUNGLElBQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxPQUFPLENBQUMsY0FBYyxFQUFFLE1BQU0sQ0FBQztpQkFDckMsT0FBTyxDQUFDLGtCQUFrQixFQUFFLE1BQU0sQ0FBQztpQkFDbkMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztZQUM1QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQ7Ozs7Ozs7OztXQVNHO1FBQ0gsb0NBQWEsR0FBYixVQUFjLEVBQWlCO1lBQzdCLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQztnQkFBRSxPQUFPLFNBQVMsQ0FBQztZQUMxRCw0REFBNEQ7WUFDNUQsa0JBQWtCO1lBQ2xCLElBQUksUUFBUSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUUxRSxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQztZQUU3Qyw2REFBNkQ7WUFDN0QsRUFBRTtZQUNGLHlEQUF5RDtZQUN6RCwwRUFBMEU7WUFDMUUsZ0VBQWdFO1lBQ2hFLDJFQUEyRTtZQUMzRSxvQ0FBb0M7WUFDcEMseUVBQXlFO1lBQ3pFLDREQUE0RDtZQUM1RCxJQUFJLFFBQVEsQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLEVBQUU7Z0JBQ3BDLElBQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ2xDLFNBQVMsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3JCLFFBQVEsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQzthQUNyQztZQUVELElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUU7Z0JBQzdCLElBQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7Z0JBQy9FLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUU7b0JBQ3RDLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVO3dCQUN6QixJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQzs0QkFDN0MsZ0JBQWdCLEVBQUU7d0JBQ3hCLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUM7cUJBQ2xDO29CQUNELG1FQUFtRTtvQkFDbkUsaUNBQWlDO29CQUNqQyx1RUFBdUU7b0JBQ3ZFLDBEQUEwRDtvQkFDMUQsSUFBSSxnQkFBZ0IsS0FBSyxPQUFPLEVBQUU7d0JBQ2hDLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUM7cUJBQ2xDO29CQUNELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztpQkFDckU7YUFDRjtZQUVELGtCQUFrQjtZQUNsQiwyQkFBMkI7WUFDM0IsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDOUMsQ0FBQztRQUVEOzs7V0FHRztRQUNLLGlEQUEwQixHQUFsQyxVQUFtQyxRQUFnQixFQUFFLE9BQWdCO1lBQ25FLDJEQUEyRDtZQUMzRCxlQUFlO1lBQ2YsSUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLGNBQWMsQ0FBQyxDQUFDO1lBQzFELElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsRUFBRTtnQkFDNUIsSUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO2dCQUMxRCxJQUFJLE9BQU8sR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQzdCLElBQUksT0FBTyxFQUFFO29CQUNYLElBQUksT0FBTyxLQUFLLEdBQUcsSUFBSSxPQUFPLEtBQUssSUFBSSxFQUFFO3dCQUN2QyxPQUFPLEdBQUcsWUFBWSxDQUFDO3FCQUN4QjtvQkFDRCxJQUFNLE9BQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7b0JBQ2pELElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFLLENBQUMsRUFBRTt3QkFDMUIsT0FBTyxFQUFFLE9BQU8sU0FBQSxFQUFFLGdCQUFnQixFQUFFLE9BQUssRUFBRSxDQUFDO3FCQUM3QztpQkFDRjthQUNGO1lBRUQsMENBQTBDO1lBQzFDLElBQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxZQUFZLENBQUMsQ0FBQztZQUN0RCxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEVBQUU7Z0JBQzFCLE9BQU8sRUFBRSxPQUFPLFNBQUEsRUFBRSxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsQ0FBQzthQUM3QztZQUVELE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7UUFFRDs7Ozs7V0FLRztRQUNILHFEQUE4QixHQUE5QixVQUErQixLQUFlLEVBQUUsY0FBc0I7WUFBdEUsaUJBdUNDO1lBdENDLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCO2dCQUFFLE9BQU8sRUFBRSxDQUFDO1lBQzNDLElBQU0sTUFBTSxHQUF3QyxFQUFFLENBQUM7WUFDdkQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFBLElBQUk7Z0JBQ2hCLElBQUksUUFBdUQsQ0FBQztnQkFFNUQsaUJBQWlCO2dCQUNqQixLQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsVUFBQSxRQUFRO29CQUNyQyxJQUFJLENBQUMsUUFBUSxFQUFFO3dCQUNiLFFBQVEsR0FBRyxLQUFJLENBQUMsMEJBQTBCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO3FCQUNuRjtnQkFDSCxDQUFDLENBQUMsQ0FBQztnQkFFSCxtQkFBbUI7Z0JBQ25CLElBQUksQ0FBQyxRQUFRLEVBQUU7b0JBQ2IsUUFBUSxHQUFHLEtBQUksQ0FBQywwQkFBMEIsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO2lCQUM1RztnQkFFRCx3RUFBd0U7Z0JBQ3hFLHlFQUF5RTtnQkFDekUsc0VBQXNFO2dCQUN0RSxJQUFJLENBQUMsUUFBUSxFQUFFO29CQUNiLElBQUksY0FBSyxFQUFFO3dCQUNULGNBQUssQ0FBQyxpREFBK0MsSUFBSSxNQUFHLENBQUMsQ0FBQztxQkFDL0Q7b0JBQ0QsT0FBTztpQkFDUjtnQkFDRCxzREFBc0Q7Z0JBQ3RELDBFQUEwRTtnQkFDMUUsd0VBQXdFO2dCQUN4RSwwRUFBMEU7Z0JBQzFFLDhFQUE4RTtnQkFDOUUsOERBQThEO2dCQUM5RCw2REFBNkQ7Z0JBQzdELHlEQUF5RDtnQkFDekQsc0RBQXNEO2dCQUN0RCxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQTZDLENBQUMsQ0FBQztZQUM3RCxDQUFDLENBQUMsQ0FBQztZQUNILE9BQU8sTUFBTSxDQUFDO1FBQ2hCLENBQUM7UUFFRCxvREFBb0Q7UUFDcEQsb0NBQWEsR0FBYixVQUNJLFFBQWdCLEVBQUUsZUFBZ0MsRUFDbEQsT0FBbUM7WUFGdkMsaUJBdUJDO1lBcEJDLE9BQU8sU0FBUyxDQUFDLElBQUksQ0FBQyxtQkFBaUIsUUFBVSxFQUFFO2dCQUNqRCxJQUFNLEVBQUUsR0FBRyxLQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO2dCQUN6RSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7b0JBQzVCLENBQUMsS0FBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEtBQUssRUFBRSxDQUFDLFVBQVUsQ0FBQyxHQUFHO3dCQUN6QyxLQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sS0FBSyxFQUFFLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFO29CQUMvQyxJQUFNLFVBQVUsR0FBRyxLQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUMxQyxJQUFJLEVBQUUsQ0FBQyxVQUFVLEtBQUssVUFBVSxJQUFJLENBQUMsVUFBVTt3QkFBRSxPQUFPLEVBQUUsQ0FBQztvQkFDM0QsSUFBSSxFQUFFLENBQUMsVUFBVSxFQUFFO3dCQUNqQixNQUFNLElBQUksS0FBSyxDQUNYLFlBQVUsRUFBRSxDQUFDLFFBQVEsTUFBRzs2QkFDeEIsd0NBQXNDLEVBQUUsQ0FBQyxVQUFVLE1BQUcsQ0FBQTs2QkFDdEQscUNBQW1DLFVBQVUsTUFBRyxDQUFBOzRCQUNoRCxpQ0FBaUMsQ0FBQyxDQUFDO3FCQUN4QztvQkFDRCx1RUFBdUU7b0JBQ3ZFLDhDQUE4QztvQkFDOUMsRUFBRSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7aUJBQzVCO2dCQUNELE9BQU8sRUFBRSxDQUFDO1lBQ1osQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsZ0NBQVMsR0FBVCxVQUNJLFFBQWdCLEVBQUUsT0FBZSxFQUFFLGtCQUEyQixFQUM5RCxPQUE4QyxFQUM5QyxXQUFtRDtZQUh2RCxpQkFRQztZQUpDLFNBQVMsQ0FBQyxJQUFJLENBQ1YsZUFBYSxRQUFVLEVBQ3ZCLGNBQU0sT0FBQSxLQUFJLENBQUMsYUFBYSxDQUNwQixRQUFRLEVBQUUsT0FBTyxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxXQUFXLENBQUMsRUFEMUQsQ0FDMEQsQ0FBQyxDQUFDO1FBQ3hFLENBQUM7UUFFRCxvQ0FBYSxHQUFiLFVBQ0ksUUFBZ0IsRUFBRSxPQUFlLEVBQUUsa0JBQTJCLEVBQzlELE9BQThDLEVBQzlDLFdBQW1EO1lBQ3JELGtFQUFrRTtZQUNsRSw4QkFBOEI7WUFDOUIsSUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFDLGlCQUFpQixDQUFDO1lBQy9CLElBQUEsMEVBQXVELEVBQXRELGFBQUssRUFBRSxhQUErQyxDQUFDO1lBQzlELElBQU0sZ0JBQWdCLEdBQUcsS0FBSyxJQUFJLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDO1lBQ2xELElBQUksZ0JBQWdCO2dCQUNoQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxLQUFLLEVBQUUsQ0FBQyxVQUFVLENBQUMsR0FBRztvQkFDekMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEtBQUssRUFBRSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUM7Z0JBQzNDLFFBQVEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksV0FBVyxJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQztnQkFDbkUsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsRUFBRTtnQkFDN0IsT0FBTztvQkFDSCw0QkFBeUIsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsZUFBUyxPQUFTLENBQUM7YUFDMUU7WUFDRCxRQUFRLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUV4QyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsaUJBQWlCLEVBQUU7Z0JBQ3BDLFFBQVEsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLDBCQUEyQixDQUFDO2FBQ3ZEO2lCQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRTtnQkFDbEMsOENBQThDO2dCQUM5QyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFO29CQUN6Qiw0REFBNEQ7b0JBQzVELDJDQUEyQztvQkFDM0MsUUFBUSxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsZUFBZSxDQUFDLENBQUM7aUJBQ2xFO3FCQUFNO29CQUNMLFFBQVEsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxhQUFhLENBQUMsQ0FBQztpQkFDckQ7YUFDRjtZQUVELGdDQUFnQztZQUNoQyxRQUFRLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQztZQUVwRCxvRUFBb0U7WUFDcEUsa0JBQWtCO1lBQ2xCLElBQUksQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztnQkFDeEIsRUFBRSxDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLEtBQUssT0FBTyxFQUFFO2dCQUNsRCxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FDbkIsUUFBUSxFQUFFLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7YUFDbEU7UUFDSCxDQUFDO1FBRUQ7Ozs7Ozs7V0FPRztRQUNILGlDQUFVLEdBQVYsVUFBVyxRQUFnQjtZQUN6QixrRUFBa0U7WUFDbEUsMkVBQTJFO1lBQzNFLDJFQUEyRTtZQUMzRSw0RUFBNEU7WUFDNUUsc0RBQXNEO1lBQ3RELDJFQUEyRTtZQUMzRSxxRUFBcUU7WUFDckUsc0RBQXNEO1lBQ3RELElBQUksSUFBSSxDQUFDLHFCQUFxQixJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQ3pFLElBQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUNwRCxJQUFJLGNBQUssSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsRUFBRTtvQkFDMUQsY0FBSyxDQUFDLGlEQUFpRCxFQUFFLFFBQVEsQ0FBQyxDQUFDO29CQUNuRSxNQUFNLENBQUMsSUFBSSxDQUFFLElBQUksQ0FBQyxVQUFrQixDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBQSxDQUFDO3dCQUMvRCxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFOzRCQUN2QyxjQUFLLENBQUMsZ0NBQWdDLEVBQUUsQ0FBQyxDQUFDLENBQUM7eUJBQzVDO29CQUNILENBQUMsQ0FBQyxDQUFDO2lCQUNKO2dCQUNELE9BQU8sTUFBTSxDQUFDO2FBQ2Y7WUFDRCxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFFRCw0Q0FBcUIsR0FBckI7WUFDRSwwRUFBMEU7WUFDMUUsaUNBQWlDO1lBQ2pDLHFFQUFxRTtZQUNyRSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQ2YsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2pFLENBQUM7UUFFRCw0Q0FBcUIsR0FBckIsVUFBc0IsT0FBMkI7WUFDL0MsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQixFQUFFO2dCQUNwQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQ1osSUFBSSxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsRUFBRSxnQkFBZ0IsRUFDbEQsRUFBRSxDQUFDLHFCQUFxQixDQUFDLEVBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFDLENBQUMsQ0FBQyxDQUFDO2FBQzlEO1lBQ0QsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3RELENBQUM7UUFFRCwrQkFBUSxHQUFSLFVBQVMsQ0FBUztZQUNoQiwwRUFBMEU7WUFDMUUsMkNBQTJDO1lBQzNDLHlFQUF5RTtZQUN6RSx5RUFBeUU7WUFDekUseUNBQXlDO1lBQ3pDLHlEQUF5RDtZQUN6RCw0Q0FBNEM7WUFDNUMsT0FBTyxDQUFDLENBQUM7UUFDWCxDQUFDO1FBRUQsMERBQTBEO1FBRTFELDJDQUFvQixHQUFwQixVQUFxQixJQUFZO1lBQy9CLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNsRCxDQUFDO1FBRUQsMENBQW1CLEdBQW5CO1lBQ0UsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLG1CQUFtQixFQUFFLENBQUM7UUFDN0MsQ0FBQztRQUVELGdEQUF5QixHQUF6QjtZQUNFLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyx5QkFBeUIsRUFBRSxDQUFDO1FBQ25ELENBQUM7UUFFRCxpQ0FBVSxHQUFWO1lBQ0UsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3BDLENBQUM7UUFFRCxxQ0FBYyxHQUFkLFVBQWUsSUFBWTtZQUN6QixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzVDLENBQUM7UUFFRCwrQkFBUSxHQUFSLFVBQVMsUUFBZ0I7WUFDdkIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMxQyxDQUFDO1FBRUQsNEJBQUssR0FBTCxVQUFNLENBQVM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ25CLENBQUM7UUFDSCxtQkFBQztJQUFELENBQUMsQUF2aEJELElBdWhCQztJQXZoQlksb0NBQVkiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHNpY2tsZSBmcm9tICd0c2lja2xlJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuXG5pbXBvcnQge0ZpbGVMb2FkZXJ9IGZyb20gJy4vY2FjaGUnO1xuaW1wb3J0ICogYXMgcGVyZlRyYWNlIGZyb20gJy4vcGVyZl90cmFjZSc7XG5pbXBvcnQge0JhemVsT3B0aW9uc30gZnJvbSAnLi90c2NvbmZpZyc7XG5pbXBvcnQge0RFQlVHLCBkZWJ1Z30gZnJvbSAnLi93b3JrZXInO1xuXG5leHBvcnQgdHlwZSBNb2R1bGVSZXNvbHZlciA9XG4gICAgKG1vZHVsZU5hbWU6IHN0cmluZywgY29udGFpbmluZ0ZpbGU6IHN0cmluZyxcbiAgICAgY29tcGlsZXJPcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMsIGhvc3Q6IHRzLk1vZHVsZVJlc29sdXRpb25Ib3N0KSA9PlxuICAgICAgICB0cy5SZXNvbHZlZE1vZHVsZVdpdGhGYWlsZWRMb29rdXBMb2NhdGlvbnM7XG5cbi8qKlxuICogTmFycm93cyBkb3duIHRoZSB0eXBlIG9mIHNvbWUgcHJvcGVydGllcyBmcm9tIG5vbi1vcHRpb25hbCB0byByZXF1aXJlZCwgc29cbiAqIHRoYXQgd2UgZG8gbm90IG5lZWQgdG8gY2hlY2sgcHJlc2VuY2UgYmVmb3JlIGVhY2ggYWNjZXNzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEJhemVsVHNPcHRpb25zIGV4dGVuZHMgdHMuQ29tcGlsZXJPcHRpb25zIHtcbiAgcm9vdERpcnM6IHN0cmluZ1tdO1xuICByb290RGlyOiBzdHJpbmc7XG4gIG91dERpcjogc3RyaW5nO1xuICB0eXBlUm9vdHM6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmFycm93VHNPcHRpb25zKG9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyk6IEJhemVsVHNPcHRpb25zIHtcbiAgaWYgKCFvcHRpb25zLnJvb3REaXJzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBjb21waWxlck9wdGlvbnMucm9vdERpcnMgc2hvdWxkIGJlIHNldCBieSB0c2NvbmZpZy5iemxgKTtcbiAgfVxuICBpZiAoIW9wdGlvbnMucm9vdERpcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgY29tcGlsZXJPcHRpb25zLnJvb3REaXJzIHNob3VsZCBiZSBzZXQgYnkgdHNjb25maWcuYnpsYCk7XG4gIH1cbiAgaWYgKCFvcHRpb25zLm91dERpcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgY29tcGlsZXJPcHRpb25zLnJvb3REaXJzIHNob3VsZCBiZSBzZXQgYnkgdHNjb25maWcuYnpsYCk7XG4gIH1cbiAgcmV0dXJuIG9wdGlvbnMgYXMgQmF6ZWxUc09wdGlvbnM7XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlQmF6ZWxPcHRpb25zKGJhemVsT3B0czogQmF6ZWxPcHRpb25zKSB7XG4gIGlmICghYmF6ZWxPcHRzLmlzSnNUcmFuc3BpbGF0aW9uKSByZXR1cm47XG5cbiAgaWYgKGJhemVsT3B0cy5jb21waWxhdGlvblRhcmdldFNyYyAmJlxuICAgICAgYmF6ZWxPcHRzLmNvbXBpbGF0aW9uVGFyZ2V0U3JjLmxlbmd0aCA+IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbiBKUyB0cmFuc3BpbGF0aW9uIG1vZGUsIG9ubHkgb25lIGZpbGUgY2FuIGFwcGVhciBpbiBcIiArXG4gICAgICAgICAgICAgICAgICAgIFwiYmF6ZWxPcHRpb25zLmNvbXBpbGF0aW9uVGFyZ2V0U3JjLlwiKTtcbiAgfVxuXG4gIGlmICghYmF6ZWxPcHRzLnRyYW5zcGlsZWRKc091dHB1dEZpbGVOYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiSW4gSlMgdHJhbnNwaWxhdGlvbiBtb2RlLCB0cmFuc3BpbGVkSnNPdXRwdXRGaWxlTmFtZSBcIiArXG4gICAgICAgICAgICAgICAgICAgIFwibXVzdCBiZSBzcGVjaWZpZWQgaW4gdHNjb25maWcuXCIpO1xuICB9XG59XG5cbmNvbnN0IFNPVVJDRV9FWFQgPSAvKChcXC5kKT9cXC50c3g/fFxcLmpzKSQvO1xuXG4vKipcbiAqIENvbXBpbGVySG9zdCB0aGF0IGtub3dzIGhvdyB0byBjYWNoZSBwYXJzZWQgZmlsZXMgdG8gaW1wcm92ZSBjb21waWxlIHRpbWVzLlxuICovXG5leHBvcnQgY2xhc3MgQ29tcGlsZXJIb3N0IGltcGxlbWVudHMgdHMuQ29tcGlsZXJIb3N0LCB0c2lja2xlLlRzaWNrbGVIb3N0IHtcbiAgLyoqXG4gICAqIExvb2t1cCB0YWJsZSB0byBhbnN3ZXIgZmlsZSBzdGF0J3Mgd2l0aG91dCBsb29raW5nIG9uIGRpc2suXG4gICAqL1xuICBwcml2YXRlIGtub3duRmlsZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAvKipcbiAgICogcm9vdERpcnMgcmVsYXRpdmUgdG8gdGhlIHJvb3REaXIsIGVnIFwiYmF6ZWwtb3V0L2xvY2FsLWZhc3RidWlsZC9iaW5cIlxuICAgKi9cbiAgcHJpdmF0ZSByZWxhdGl2ZVJvb3RzOiBzdHJpbmdbXTtcblxuICBnZXRDYW5jZWxhdGlvblRva2VuPzogKCkgPT4gdHMuQ2FuY2VsbGF0aW9uVG9rZW47XG4gIGRpcmVjdG9yeUV4aXN0cz86IChkaXI6IHN0cmluZykgPT4gYm9vbGVhbjtcblxuICBnb29nbW9kdWxlOiBib29sZWFuO1xuICBlczVNb2RlOiBib29sZWFuO1xuICBwcmVsdWRlOiBzdHJpbmc7XG4gIHVudHlwZWQ6IGJvb2xlYW47XG4gIHR5cGVCbGFja0xpc3RQYXRoczogU2V0PHN0cmluZz47XG4gIHRyYW5zZm9ybURlY29yYXRvcnM6IGJvb2xlYW47XG4gIHRyYW5zZm9ybVR5cGVzVG9DbG9zdXJlOiBib29sZWFuO1xuICBhZGREdHNDbHV0ekFsaWFzZXM6IGJvb2xlYW47XG4gIGlzSnNUcmFuc3BpbGF0aW9uOiBib29sZWFuO1xuICBwcm92aWRlRXh0ZXJuYWxNb2R1bGVEdHNOYW1lc3BhY2U6IGJvb2xlYW47XG4gIG9wdGlvbnM6IEJhemVsVHNPcHRpb25zO1xuICBtb2R1bGVSZXNvbHV0aW9uSG9zdDogdHMuTW9kdWxlUmVzb2x1dGlvbkhvc3QgPSB0aGlzO1xuICAvLyBUT0RPKGV2YW5tKTogZGVsZXRlIHRoaXMgb25jZSB0c2lja2xlIGlzIHVwZGF0ZWQuXG4gIGhvc3Q6IHRzLk1vZHVsZVJlc29sdXRpb25Ib3N0ID0gdGhpcztcbiAgcHJpdmF0ZSBhbGxvd0FjdGlvbklucHV0UmVhZHMgPSB0cnVlO1xuXG5cbiAgY29uc3RydWN0b3IoXG4gICAgICBwdWJsaWMgaW5wdXRGaWxlczogc3RyaW5nW10sIG9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyxcbiAgICAgIHJlYWRvbmx5IGJhemVsT3B0czogQmF6ZWxPcHRpb25zLCBwcml2YXRlIGRlbGVnYXRlOiB0cy5Db21waWxlckhvc3QsXG4gICAgICBwcml2YXRlIGZpbGVMb2FkZXI6IEZpbGVMb2FkZXIsXG4gICAgICBwcml2YXRlIG1vZHVsZVJlc29sdmVyOiBNb2R1bGVSZXNvbHZlciA9IHRzLnJlc29sdmVNb2R1bGVOYW1lKSB7XG4gICAgdGhpcy5vcHRpb25zID0gbmFycm93VHNPcHRpb25zKG9wdGlvbnMpO1xuICAgIHRoaXMucmVsYXRpdmVSb290cyA9XG4gICAgICAgIHRoaXMub3B0aW9ucy5yb290RGlycy5tYXAociA9PiBwYXRoLnJlbGF0aXZlKHRoaXMub3B0aW9ucy5yb290RGlyLCByKSk7XG4gICAgaW5wdXRGaWxlcy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICB0aGlzLmtub3duRmlsZXMuYWRkKGYpO1xuICAgIH0pO1xuXG4gICAgLy8gZ2V0Q2FuY2VsYXRpb25Ub2tlbiBpcyBhbiBvcHRpb25hbCBtZXRob2Qgb24gdGhlIGRlbGVnYXRlLiBJZiB3ZVxuICAgIC8vIHVuY29uZGl0aW9uYWxseSBpbXBsZW1lbnQgdGhlIG1ldGhvZCwgd2Ugd2lsbCBiZSBmb3JjZWQgdG8gcmV0dXJuIG51bGwsXG4gICAgLy8gaW4gdGhlIGFic2Vuc2Ugb2YgdGhlIGRlbGVnYXRlIG1ldGhvZC4gVGhhdCB3b24ndCBtYXRjaCB0aGUgcmV0dXJuIHR5cGUuXG4gICAgLy8gSW5zdGVhZCwgd2Ugb3B0aW9uYWxseSBzZXQgYSBmdW5jdGlvbiB0byBhIGZpZWxkIHdpdGggdGhlIHNhbWUgbmFtZS5cbiAgICBpZiAoZGVsZWdhdGUgJiYgZGVsZWdhdGUuZ2V0Q2FuY2VsbGF0aW9uVG9rZW4pIHtcbiAgICAgIHRoaXMuZ2V0Q2FuY2VsYXRpb25Ub2tlbiA9IGRlbGVnYXRlLmdldENhbmNlbGxhdGlvblRva2VuLmJpbmQoZGVsZWdhdGUpO1xuICAgIH1cblxuICAgIC8vIE92ZXJyaWRlIGRpcmVjdG9yeUV4aXN0cyBzbyB0aGF0IFR5cGVTY3JpcHQgY2FuIGF1dG9tYXRpY2FsbHlcbiAgICAvLyBpbmNsdWRlIGdsb2JhbCB0eXBpbmdzIGZyb20gbm9kZV9tb2R1bGVzL0B0eXBlc1xuICAgIC8vIHNlZSBnZXRBdXRvbWF0aWNUeXBlRGlyZWN0aXZlTmFtZXMgaW5cbiAgICAvLyBUeXBlU2NyaXB0OnNyYy9jb21waWxlci9tb2R1bGVOYW1lUmVzb2x2ZXJcbiAgICBpZiAodGhpcy5hbGxvd0FjdGlvbklucHV0UmVhZHMgJiYgZGVsZWdhdGUgJiYgZGVsZWdhdGUuZGlyZWN0b3J5RXhpc3RzKSB7XG4gICAgICB0aGlzLmRpcmVjdG9yeUV4aXN0cyA9IGRlbGVnYXRlLmRpcmVjdG9yeUV4aXN0cy5iaW5kKGRlbGVnYXRlKTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZUJhemVsT3B0aW9ucyhiYXplbE9wdHMpO1xuICAgIHRoaXMuZ29vZ21vZHVsZSA9IGJhemVsT3B0cy5nb29nbW9kdWxlO1xuICAgIHRoaXMuZXM1TW9kZSA9IGJhemVsT3B0cy5lczVNb2RlO1xuICAgIHRoaXMucHJlbHVkZSA9IGJhemVsT3B0cy5wcmVsdWRlO1xuICAgIHRoaXMudW50eXBlZCA9IGJhemVsT3B0cy51bnR5cGVkO1xuICAgIHRoaXMudHlwZUJsYWNrTGlzdFBhdGhzID0gbmV3IFNldChiYXplbE9wdHMudHlwZUJsYWNrTGlzdFBhdGhzKTtcbiAgICB0aGlzLnRyYW5zZm9ybURlY29yYXRvcnMgPSBiYXplbE9wdHMudHNpY2tsZTtcbiAgICB0aGlzLnRyYW5zZm9ybVR5cGVzVG9DbG9zdXJlID0gYmF6ZWxPcHRzLnRzaWNrbGU7XG4gICAgdGhpcy5hZGREdHNDbHV0ekFsaWFzZXMgPSBiYXplbE9wdHMuYWRkRHRzQ2x1dHpBbGlhc2VzO1xuICAgIHRoaXMuaXNKc1RyYW5zcGlsYXRpb24gPSBCb29sZWFuKGJhemVsT3B0cy5pc0pzVHJhbnNwaWxhdGlvbik7XG4gICAgdGhpcy5wcm92aWRlRXh0ZXJuYWxNb2R1bGVEdHNOYW1lc3BhY2UgPSAhYmF6ZWxPcHRzLmhhc0ltcGxlbWVudGF0aW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIEZvciB0aGUgZ2l2ZW4gcG90ZW50aWFsbHkgYWJzb2x1dGUgaW5wdXQgZmlsZSBwYXRoICh0eXBpY2FsbHkgLnRzKSwgcmV0dXJuc1xuICAgKiB0aGUgcmVsYXRpdmUgb3V0cHV0IHBhdGguIEZvciBleGFtcGxlLCBmb3JcbiAgICogL3BhdGgvdG8vcm9vdC9ibGF6ZS1vdXQvazgtZmFzdGJ1aWxkL2dlbmZpbGVzL215L2ZpbGUudHMsIHdpbGwgcmV0dXJuXG4gICAqIG15L2ZpbGUuanMgb3IgbXkvZmlsZS5jbG9zdXJlLmpzIChkZXBlbmRpbmcgb24gRVM1IG1vZGUpLlxuICAgKi9cbiAgcmVsYXRpdmVPdXRwdXRQYXRoKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICBsZXQgcmVzdWx0ID0gdGhpcy5yb290RGlyc1JlbGF0aXZlKGZpbGVOYW1lKTtcbiAgICByZXN1bHQgPSByZXN1bHQucmVwbGFjZSgvKFxcLmQpP1xcLltqdF1zeD8kLywgJycpO1xuICAgIGlmICghdGhpcy5iYXplbE9wdHMuZXM1TW9kZSkgcmVzdWx0ICs9ICcuY2xvc3VyZSc7XG4gICAgcmV0dXJuIHJlc3VsdCArICcuanMnO1xuICB9XG5cbiAgLyoqXG4gICAqIFdvcmthcm91bmQgaHR0cHM6Ly9naXRodWIuY29tL01pY3Jvc29mdC9UeXBlU2NyaXB0L2lzc3Vlcy84MjQ1XG4gICAqIFdlIHVzZSB0aGUgYHJvb3REaXJzYCBwcm9wZXJ0eSBib3RoIGZvciBtb2R1bGUgcmVzb2x1dGlvbixcbiAgICogYW5kICphbHNvKiB0byBmbGF0dGVuIHRoZSBzdHJ1Y3R1cmUgb2YgdGhlIG91dHB1dCBkaXJlY3RvcnlcbiAgICogKGFzIGByb290RGlyYCB3b3VsZCBkbyBmb3IgYSBzaW5nbGUgcm9vdCkuXG4gICAqIFRvIGRvIHRoaXMsIGxvb2sgZm9yIHRoZSBwYXR0ZXJuIG91dERpci9yZWxhdGl2ZVJvb3RzW2ldL3BhdGgvdG8vZmlsZVxuICAgKiBvciByZWxhdGl2ZVJvb3RzW2ldL3BhdGgvdG8vZmlsZVxuICAgKiBhbmQgcmVwbGFjZSB0aGF0IHdpdGggcGF0aC90by9maWxlXG4gICAqL1xuICBmbGF0dGVuT3V0RGlyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGxldCByZXN1bHQgPSBmaWxlTmFtZTtcblxuICAgIC8vIG91dERpci9yZWxhdGl2ZVJvb3RzW2ldL3BhdGgvdG8vZmlsZSAtPiByZWxhdGl2ZVJvb3RzW2ldL3BhdGgvdG8vZmlsZVxuICAgIGlmIChmaWxlTmFtZS5zdGFydHNXaXRoKHRoaXMub3B0aW9ucy5yb290RGlyKSkge1xuICAgICAgcmVzdWx0ID0gcGF0aC5yZWxhdGl2ZSh0aGlzLm9wdGlvbnMub3V0RGlyLCBmaWxlTmFtZSk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkaXIgb2YgdGhpcy5yZWxhdGl2ZVJvb3RzKSB7XG4gICAgICAvLyByZWxhdGl2ZVJvb3RzW2ldL3BhdGgvdG8vZmlsZSAtPiBwYXRoL3RvL2ZpbGVcbiAgICAgIGNvbnN0IHJlbCA9IHBhdGgucmVsYXRpdmUoZGlyLCByZXN1bHQpO1xuICAgICAgaWYgKCFyZWwuc3RhcnRzV2l0aCgnLi4nKSkge1xuICAgICAgICByZXN1bHQgPSByZWw7XG4gICAgICAgIC8vIHJlbGF0aXZlUm9vdHMgaXMgc29ydGVkIGxvbmdlc3QgZmlyc3Qgc28gd2UgY2FuIHNob3J0LWNpcmN1aXRcbiAgICAgICAgLy8gYWZ0ZXIgdGhlIGZpcnN0IG1hdGNoXG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLyoqIEF2b2lkIHVzaW5nIHRzaWNrbGUgb24gZmlsZXMgdGhhdCBhcmVuJ3QgaW4gc3Jjc1tdICovXG4gIHNob3VsZFNraXBUc2lja2xlUHJvY2Vzc2luZyhmaWxlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuYmF6ZWxPcHRzLmlzSnNUcmFuc3BpbGF0aW9uIHx8XG4gICAgICAgICAgIHRoaXMuYmF6ZWxPcHRzLmNvbXBpbGF0aW9uVGFyZ2V0U3JjLmluZGV4T2YoZmlsZU5hbWUpID09PSAtMTtcbiAgfVxuXG4gIC8qKiBXaGV0aGVyIHRoZSBmaWxlIGlzIGV4cGVjdGVkIHRvIGJlIGltcG9ydGVkIHVzaW5nIGEgbmFtZWQgbW9kdWxlICovXG4gIHNob3VsZE5hbWVNb2R1bGUoZmlsZU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmJhemVsT3B0cy5jb21waWxhdGlvblRhcmdldFNyYy5pbmRleE9mKGZpbGVOYW1lKSAhPT0gLTE7XG4gIH1cblxuICAvKiogQWxsb3dzIHN1cHByZXNzaW5nIHdhcm5pbmdzIGZvciBzcGVjaWZpYyBrbm93biBsaWJyYXJpZXMgKi9cbiAgc2hvdWxkSWdub3JlV2FybmluZ3NGb3JQYXRoKGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5iYXplbE9wdHMuaWdub3JlV2FybmluZ1BhdGhzLnNvbWUoXG4gICAgICAgIHAgPT4gISFmaWxlUGF0aC5tYXRjaChuZXcgUmVnRXhwKHApKSk7XG4gIH1cblxuICAvKipcbiAgICogZmlsZU5hbWVUb01vZHVsZUlkIGdpdmVzIHRoZSBtb2R1bGUgSUQgZm9yIGFuIGlucHV0IHNvdXJjZSBmaWxlIG5hbWUuXG4gICAqIEBwYXJhbSBmaWxlTmFtZSBhbiBpbnB1dCBzb3VyY2UgZmlsZSBuYW1lLCBlLmcuXG4gICAqICAgICAvcm9vdC9kaXIvYmF6ZWwtb3V0L2hvc3QvYmluL215L2ZpbGUudHMuXG4gICAqIEByZXR1cm4gdGhlIGNhbm9uaWNhbCBwYXRoIG9mIGEgZmlsZSB3aXRoaW4gYmxhemUsIHdpdGhvdXQgL2dlbmZpbGVzLyBvclxuICAgKiAgICAgL2Jpbi8gcGF0aCBwYXJ0cywgZXhjbHVkaW5nIGEgZmlsZSBleHRlbnNpb24uIEZvciBleGFtcGxlLCBcIm15L2ZpbGVcIi5cbiAgICovXG4gIGZpbGVOYW1lVG9Nb2R1bGVJZChmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5yZWxhdGl2ZU91dHB1dFBhdGgoXG4gICAgICAgIGZpbGVOYW1lLnN1YnN0cmluZygwLCBmaWxlTmFtZS5sYXN0SW5kZXhPZignLicpKSk7XG4gIH1cblxuICAvKipcbiAgICogVHlwZVNjcmlwdCBTb3VyY2VGaWxlJ3MgaGF2ZSBhIHBhdGggd2l0aCB0aGUgcm9vdERpcnNbaV0gc3RpbGwgcHJlc2VudCwgZWcuXG4gICAqIC9idWlsZC93b3JrL2JhemVsLW91dC9sb2NhbC1mYXN0YnVpbGQvYmluL3BhdGgvdG8vZmlsZVxuICAgKiBAcmV0dXJuIHRoZSBwYXRoIHdpdGhvdXQgYW55IHJvb3REaXJzLCBlZy4gcGF0aC90by9maWxlXG4gICAqL1xuICBwcml2YXRlIHJvb3REaXJzUmVsYXRpdmUoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgZm9yIChjb25zdCByb290IG9mIHRoaXMub3B0aW9ucy5yb290RGlycykge1xuICAgICAgaWYgKGZpbGVOYW1lLnN0YXJ0c1dpdGgocm9vdCkpIHtcbiAgICAgICAgLy8gcm9vdERpcnMgYXJlIHNvcnRlZCBsb25nZXN0LWZpcnN0LCBzbyBzaG9ydC1jaXJjdWl0IHRoZSBpdGVyYXRpb25cbiAgICAgICAgLy8gc2VlIHRzY29uZmlnLnRzLlxuICAgICAgICByZXR1cm4gcGF0aC5wb3NpeC5yZWxhdGl2ZShyb290LCBmaWxlTmFtZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmaWxlTmFtZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXNzYWdlcyBmaWxlIG5hbWVzIGludG8gdmFsaWQgZ29vZy5tb2R1bGUgbmFtZXM6XG4gICAqIC0gcmVzb2x2ZXMgcmVsYXRpdmUgcGF0aHMgdG8gdGhlIGdpdmVuIGNvbnRleHRcbiAgICogLSByZXNvbHZlcyBub24tcmVsYXRpdmUgcGF0aHMgd2hpY2ggdGFrZXMgbW9kdWxlX3Jvb3QgaW50byBhY2NvdW50XG4gICAqIC0gcmVwbGFjZXMgJy8nIHdpdGggJy4nIGluIHRoZSAnPHdvcmtzcGFjZT4nIG5hbWVzcGFjZVxuICAgKiAtIHJlcGxhY2UgZmlyc3QgY2hhciBpZiBub24tYWxwaGFcbiAgICogLSByZXBsYWNlIHN1YnNlcXVlbnQgbm9uLWFscGhhIG51bWVyaWMgY2hhcnNcbiAgICovXG4gIHBhdGhUb01vZHVsZU5hbWUoY29udGV4dDogc3RyaW5nLCBpbXBvcnRQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIC8vIHRzaWNrbGUgaGFuZHMgdXMgYW4gb3V0cHV0IHBhdGgsIHdlIG5lZWQgdG8gbWFwIGl0IGJhY2sgdG8gYSBzb3VyY2VcbiAgICAvLyBwYXRoIGluIG9yZGVyIHRvIGRvIG1vZHVsZSByZXNvbHV0aW9uIHdpdGggaXQuXG4gICAgLy8gb3V0RGlyL3JlbGF0aXZlUm9vdHNbaV0vcGF0aC90by9maWxlIC0+XG4gICAgLy8gcm9vdERpci9yZWxhdGl2ZVJvb3RzW2ldL3BhdGgvdG8vZmlsZVxuICAgIGlmIChjb250ZXh0LnN0YXJ0c1dpdGgodGhpcy5vcHRpb25zLm91dERpcikpIHtcbiAgICAgIGNvbnRleHQgPSBwYXRoLmpvaW4oXG4gICAgICAgICAgdGhpcy5vcHRpb25zLnJvb3REaXIsIHBhdGgucmVsYXRpdmUodGhpcy5vcHRpb25zLm91dERpciwgY29udGV4dCkpO1xuICAgIH1cblxuICAgIC8vIFRyeSB0byBnZXQgdGhlIHJlc29sdmVkIHBhdGggbmFtZSBmcm9tIFRTIGNvbXBpbGVyIGhvc3Qgd2hpY2ggY2FuXG4gICAgLy8gaGFuZGxlIHJlc29sdXRpb24gZm9yIGxpYnJhcmllcyB3aXRoIG1vZHVsZV9yb290IGxpa2UgcnhqcyBhbmQgQGFuZ3VsYXIuXG4gICAgbGV0IHJlc29sdmVkUGF0aDogc3RyaW5nfG51bGwgPSBudWxsO1xuICAgIGNvbnN0IHJlc29sdmVkID1cbiAgICAgICAgdGhpcy5tb2R1bGVSZXNvbHZlcihpbXBvcnRQYXRoLCBjb250ZXh0LCB0aGlzLm9wdGlvbnMsIHRoaXMpO1xuICAgIGlmIChyZXNvbHZlZCAmJiByZXNvbHZlZC5yZXNvbHZlZE1vZHVsZSAmJlxuICAgICAgICByZXNvbHZlZC5yZXNvbHZlZE1vZHVsZS5yZXNvbHZlZEZpbGVOYW1lKSB7XG4gICAgICByZXNvbHZlZFBhdGggPSByZXNvbHZlZC5yZXNvbHZlZE1vZHVsZS5yZXNvbHZlZEZpbGVOYW1lO1xuICAgICAgLy8gL2J1aWxkL3dvcmsvYmF6ZWwtb3V0L2xvY2FsLWZhc3RidWlsZC9iaW4vcGF0aC90by9maWxlIC0+XG4gICAgICAvLyBwYXRoL3RvL2ZpbGVcbiAgICAgIHJlc29sdmVkUGF0aCA9IHRoaXMucm9vdERpcnNSZWxhdGl2ZShyZXNvbHZlZFBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBpbXBvcnRQYXRoIGNhbiBiZSBhbiBhYnNvbHV0ZSBmaWxlIHBhdGggaW4gZ29vZ2xlMy5cbiAgICAgIC8vIFRyeSB0byB0cmltIGl0IGFzIGEgcGF0aCByZWxhdGl2ZSB0byBiaW4gYW5kIGdlbmZpbGVzLCBhbmQgaWYgc28sXG4gICAgICAvLyBoYW5kbGUgaXRzIGZpbGUgZXh0ZW5zaW9uIGluIHRoZSBibG9jayBiZWxvdyBhbmQgcHJlcGVuZCB0aGUgd29ya3NwYWNlXG4gICAgICAvLyBuYW1lLlxuICAgICAgY29uc3QgdHJpbW1lZCA9IHRoaXMucm9vdERpcnNSZWxhdGl2ZShpbXBvcnRQYXRoKTtcbiAgICAgIGlmICh0cmltbWVkICE9PSBpbXBvcnRQYXRoKSB7XG4gICAgICAgIHJlc29sdmVkUGF0aCA9IHRyaW1tZWQ7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChyZXNvbHZlZFBhdGgpIHtcbiAgICAgIC8vIFN0cmlwIGZpbGUgZXh0ZW5zaW9ucy5cbiAgICAgIGltcG9ydFBhdGggPSByZXNvbHZlZFBhdGgucmVwbGFjZShTT1VSQ0VfRVhULCAnJyk7XG4gICAgICAvLyBNYWtlIHN1cmUgYWxsIG1vZHVsZSBuYW1lcyBpbmNsdWRlIHRoZSB3b3Jrc3BhY2UgbmFtZS5cbiAgICAgIGlmIChpbXBvcnRQYXRoLmluZGV4T2YodGhpcy5iYXplbE9wdHMud29ya3NwYWNlTmFtZSkgIT09IDApIHtcbiAgICAgICAgaW1wb3J0UGF0aCA9IHBhdGgucG9zaXguam9pbih0aGlzLmJhemVsT3B0cy53b3Jrc3BhY2VOYW1lLCBpbXBvcnRQYXRoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgdGhlIF9fe0xPQ0FMRX0gZnJvbSB0aGUgbW9kdWxlIG5hbWUuXG4gICAgaWYgKHRoaXMuYmF6ZWxPcHRzLmxvY2FsZSkge1xuICAgICAgY29uc3Qgc3VmZml4ID0gJ19fJyArIHRoaXMuYmF6ZWxPcHRzLmxvY2FsZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKGltcG9ydFBhdGgudG9Mb3dlckNhc2UoKS5lbmRzV2l0aChzdWZmaXgpKSB7XG4gICAgICAgIGltcG9ydFBhdGggPSBpbXBvcnRQYXRoLnN1YnN0cmluZygwLCBpbXBvcnRQYXRoLmxlbmd0aCAtIHN1ZmZpeC5sZW5ndGgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJlcGxhY2UgY2hhcmFjdGVycyBub3Qgc3VwcG9ydGVkIGJ5IGdvb2cubW9kdWxlIGFuZCAnLicgd2l0aFxuICAgIC8vICckPEhleCBjaGFyIGNvZGU+JyBzbyB0aGF0IHRoZSBvcmlnaW5hbCBtb2R1bGUgbmFtZSBjYW4gYmUgcmUtb2J0YWluZWRcbiAgICAvLyB3aXRob3V0IGFueSBsb3NzLlxuICAgIC8vIFNlZSBnb29nLlZBTElEX01PRFVMRV9SRV8gaW4gQ2xvc3VyZSdzIGJhc2UuanMgZm9yIGNoYXJhY3RlcnMgc3VwcG9ydGVkXG4gICAgLy8gYnkgZ29vZ2xlLm1vZHVsZS5cblxuICAgIGNvbnN0IGVzY2FwZSA9IChjOiBzdHJpbmcpID0+IHtcbiAgICAgIHJldHVybiAnJCcgKyBjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpO1xuICAgIH07XG4gICAgY29uc3QgbW9kdWxlTmFtZSA9IGltcG9ydFBhdGgucmVwbGFjZSgvXlteYS16QS1aXy9dLywgZXNjYXBlKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoL1teYS16QS1aXzAtOV8vXS9nLCBlc2NhcGUpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvXFwvL2csICcuJyk7XG4gICAgcmV0dXJuIG1vZHVsZU5hbWU7XG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgZmlsZSBwYXRoIGludG8gYSB2YWxpZCBBTUQgbW9kdWxlIG5hbWUuXG4gICAqXG4gICAqIEFuIEFNRCBtb2R1bGUgY2FuIGhhdmUgYW4gYXJiaXRyYXJ5IG5hbWUsIHNvIHRoYXQgaXQgaXMgcmVxdWlyZSdkIGJ5IG5hbWVcbiAgICogcmF0aGVyIHRoYW4gYnkgcGF0aC4gU2VlIGh0dHA6Ly9yZXF1aXJlanMub3JnL2RvY3Mvd2h5YW1kLmh0bWwjbmFtZWRtb2R1bGVzXG4gICAqXG4gICAqIFwiSG93ZXZlciwgdG9vbHMgdGhhdCBjb21iaW5lIG11bHRpcGxlIG1vZHVsZXMgdG9nZXRoZXIgZm9yIHBlcmZvcm1hbmNlIG5lZWRcbiAgICogIGEgd2F5IHRvIGdpdmUgbmFtZXMgdG8gZWFjaCBtb2R1bGUgaW4gdGhlIG9wdGltaXplZCBmaWxlLiBGb3IgdGhhdCwgQU1EXG4gICAqICBhbGxvd3MgYSBzdHJpbmcgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IHRvIGRlZmluZSgpXCJcbiAgICovXG4gIGFtZE1vZHVsZU5hbWUoc2Y6IHRzLlNvdXJjZUZpbGUpOiBzdHJpbmd8dW5kZWZpbmVkIHtcbiAgICBpZiAoIXRoaXMuc2hvdWxkTmFtZU1vZHVsZShzZi5maWxlTmFtZSkpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgLy8gL2J1aWxkL3dvcmsvYmF6ZWwtb3V0L2xvY2FsLWZhc3RidWlsZC9iaW4vcGF0aC90by9maWxlLnRzXG4gICAgLy8gLT4gcGF0aC90by9maWxlXG4gICAgbGV0IGZpbGVOYW1lID0gdGhpcy5yb290RGlyc1JlbGF0aXZlKHNmLmZpbGVOYW1lKS5yZXBsYWNlKFNPVVJDRV9FWFQsICcnKTtcblxuICAgIGxldCB3b3Jrc3BhY2UgPSB0aGlzLmJhemVsT3B0cy53b3Jrc3BhY2VOYW1lO1xuXG4gICAgLy8gV29ya2Fyb3VuZCBodHRwczovL2dpdGh1Yi5jb20vYmF6ZWxidWlsZC9iYXplbC9pc3N1ZXMvMTI2MlxuICAgIC8vXG4gICAgLy8gV2hlbiB0aGUgZmlsZSBjb21lcyBmcm9tIGFuIGV4dGVybmFsIGJhemVsIHJlcG9zaXRvcnksXG4gICAgLy8gYW5kIFR5cGVTY3JpcHQgcmVzb2x2ZXMgcnVuZmlsZXMgc3ltbGlua3MsIHRoZW4gdGhlIHBhdGggd2lsbCBsb29rIGxpa2VcbiAgICAvLyBvdXRwdXRfYmFzZS9leGVjcm9vdC9sb2NhbF9yZXBvL2V4dGVybmFsL2Fub3RoZXJfcmVwby9mb28vYmFyXG4gICAgLy8gV2Ugd2FudCB0byBuYW1lIHN1Y2ggYSBtb2R1bGUgXCJhbm90aGVyX3JlcG8vZm9vL2JhclwiIGp1c3QgYXMgaXQgd291bGQgYmVcbiAgICAvLyBuYW1lZCBieSBjb2RlIGluIHRoYXQgcmVwb3NpdG9yeS5cbiAgICAvLyBBcyBhIHdvcmthcm91bmQsIGNoZWNrIGZvciB0aGUgL2V4dGVybmFsLyBwYXRoIHNlZ21lbnQsIGFuZCBmaXggdXAgdGhlXG4gICAgLy8gd29ya3NwYWNlIG5hbWUgdG8gYmUgdGhlIG5hbWUgb2YgdGhlIGV4dGVybmFsIHJlcG9zaXRvcnkuXG4gICAgaWYgKGZpbGVOYW1lLnN0YXJ0c1dpdGgoJ2V4dGVybmFsLycpKSB7XG4gICAgICBjb25zdCBwYXJ0cyA9IGZpbGVOYW1lLnNwbGl0KCcvJyk7XG4gICAgICB3b3Jrc3BhY2UgPSBwYXJ0c1sxXTtcbiAgICAgIGZpbGVOYW1lID0gcGFydHMuc2xpY2UoMikuam9pbignLycpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmJhemVsT3B0cy5tb2R1bGVOYW1lKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZUZpbGVOYW1lID0gcGF0aC5wb3NpeC5yZWxhdGl2ZSh0aGlzLmJhemVsT3B0cy5wYWNrYWdlLCBmaWxlTmFtZSk7XG4gICAgICBpZiAoIXJlbGF0aXZlRmlsZU5hbWUuc3RhcnRzV2l0aCgnLi4nKSkge1xuICAgICAgICBpZiAodGhpcy5iYXplbE9wdHMubW9kdWxlUm9vdCAmJlxuICAgICAgICAgICAgdGhpcy5iYXplbE9wdHMubW9kdWxlUm9vdC5yZXBsYWNlKFNPVVJDRV9FWFQsICcnKSA9PT1cbiAgICAgICAgICAgICAgICByZWxhdGl2ZUZpbGVOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuYmF6ZWxPcHRzLm1vZHVsZU5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgLy8gU3VwcG9ydCB0aGUgY29tbW9uIGNhc2Ugb2YgY29tbW9uanMgY29udmVudGlvbiB0aGF0IGluZGV4IGlzIHRoZVxuICAgICAgICAvLyBkZWZhdWx0IG1vZHVsZSBpbiBhIGRpcmVjdG9yeS5cbiAgICAgICAgLy8gVGhpcyBtYWtlcyBvdXIgbW9kdWxlIG5hbWluZyBzY2hlbWUgbW9yZSBjb252ZW50aW9uYWwgYW5kIGxldHMgdXNlcnNcbiAgICAgICAgLy8gcmVmZXIgdG8gbW9kdWxlcyB3aXRoIHRoZSBuYXR1cmFsIG5hbWUgdGhleSdyZSB1c2VkIHRvLlxuICAgICAgICBpZiAocmVsYXRpdmVGaWxlTmFtZSA9PT0gJ2luZGV4Jykge1xuICAgICAgICAgIHJldHVybiB0aGlzLmJhemVsT3B0cy5tb2R1bGVOYW1lO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwYXRoLnBvc2l4LmpvaW4odGhpcy5iYXplbE9wdHMubW9kdWxlTmFtZSwgcmVsYXRpdmVGaWxlTmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gcGF0aC90by9maWxlIC0+XG4gICAgLy8gbXlXb3Jrc3BhY2UvcGF0aC90by9maWxlXG4gICAgcmV0dXJuIHBhdGgucG9zaXguam9pbih3b3Jrc3BhY2UsIGZpbGVOYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgdHlwaW5ncyBmaWxlIGZyb20gYSBwYWNrYWdlIGF0IHRoZSBzcGVjaWZpZWQgcGF0aC4gSGVscGVyXG4gICAqIGZ1bmN0aW9uIHRvIGByZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXNgLlxuICAgKi9cbiAgcHJpdmF0ZSByZXNvbHZlVHlwaW5nRnJvbURpcmVjdG9yeSh0eXBlUGF0aDogc3RyaW5nLCBwcmltYXJ5OiBib29sZWFuKTogdHMuUmVzb2x2ZWRUeXBlUmVmZXJlbmNlRGlyZWN0aXZlIHwgdW5kZWZpbmVkIHtcbiAgICAvLyBMb29rcyBmb3IgdGhlIGB0eXBpbmdzYCBhdHRyaWJ1dGUgaW4gYSBwYWNrYWdlLmpzb24gZmlsZVxuICAgIC8vIGlmIGl0IGV4aXN0c1xuICAgIGNvbnN0IHBrZ0ZpbGUgPSBwYXRoLnBvc2l4LmpvaW4odHlwZVBhdGgsICdwYWNrYWdlLmpzb24nKTtcbiAgICBpZiAodGhpcy5maWxlRXhpc3RzKHBrZ0ZpbGUpKSB7XG4gICAgICBjb25zdCBwa2cgPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyhwa2dGaWxlLCAnVVRGLTgnKSk7XG4gICAgICBsZXQgdHlwaW5ncyA9IHBrZ1sndHlwaW5ncyddO1xuICAgICAgaWYgKHR5cGluZ3MpIHtcbiAgICAgICAgaWYgKHR5cGluZ3MgPT09ICcuJyB8fCB0eXBpbmdzID09PSAnLi8nKSB7XG4gICAgICAgICAgdHlwaW5ncyA9ICdpbmRleC5kLnRzJztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBtYXliZSA9IHBhdGgucG9zaXguam9pbih0eXBlUGF0aCwgdHlwaW5ncyk7XG4gICAgICAgIGlmICh0aGlzLmZpbGVFeGlzdHMobWF5YmUpKSB7XG4gICAgICAgICAgcmV0dXJuIHsgcHJpbWFyeSwgcmVzb2x2ZWRGaWxlTmFtZTogbWF5YmUgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExvb2sgZm9yIGFuIGluZGV4LmQudHMgZmlsZSBpbiB0aGUgcGF0aFxuICAgIGNvbnN0IG1heWJlID0gcGF0aC5wb3NpeC5qb2luKHR5cGVQYXRoLCAnaW5kZXguZC50cycpO1xuICAgIGlmICh0aGlzLmZpbGVFeGlzdHMobWF5YmUpKSB7XG4gICAgICByZXR1cm4geyBwcmltYXJ5LCByZXNvbHZlZEZpbGVOYW1lOiBtYXliZSB9O1xuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogT3ZlcnJpZGUgdGhlIGRlZmF1bHQgdHlwZXNjcmlwdCByZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXMgZnVuY3Rpb24uXG4gICAqIFJlc29sdmVzIC8vLyA8cmVmZXJlbmNlIHR5cGVzPVwieFwiIC8+IGRpcmVjdGl2ZXMgdW5kZXIgYmF6ZWwuIFRoZSBkZWZhdWx0XG4gICAqIHR5cGVzY3JpcHQgc2Vjb25kYXJ5IHNlYXJjaCBiZWhhdmlvciBuZWVkcyB0byBiZSBvdmVycmlkZGVuIHRvIHN1cHBvcnRcbiAgICogbG9va2luZyB1bmRlciBgYmF6ZWxPcHRzLm5vZGVNb2R1bGVzUHJlZml4YFxuICAgKi9cbiAgcmVzb2x2ZVR5cGVSZWZlcmVuY2VEaXJlY3RpdmVzKG5hbWVzOiBzdHJpbmdbXSwgY29udGFpbmluZ0ZpbGU6IHN0cmluZyk6IHRzLlJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZVtdIHtcbiAgICBpZiAoIXRoaXMuYWxsb3dBY3Rpb25JbnB1dFJlYWRzKSByZXR1cm4gW107XG4gICAgY29uc3QgcmVzdWx0OiB0cy5SZXNvbHZlZFR5cGVSZWZlcmVuY2VEaXJlY3RpdmVbXSA9IFtdO1xuICAgIG5hbWVzLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBsZXQgcmVzb2x2ZWQ6IHRzLlJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZSB8IHVuZGVmaW5lZDtcblxuICAgICAgLy8gcHJpbWFyeSBzZWFyY2hcbiAgICAgIHRoaXMub3B0aW9ucy50eXBlUm9vdHMuZm9yRWFjaCh0eXBlUm9vdCA9PiB7XG4gICAgICAgIGlmICghcmVzb2x2ZWQpIHtcbiAgICAgICAgICByZXNvbHZlZCA9IHRoaXMucmVzb2x2ZVR5cGluZ0Zyb21EaXJlY3RvcnkocGF0aC5wb3NpeC5qb2luKHR5cGVSb290LCBuYW1lKSwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBzZWNvbmRhcnkgc2VhcmNoXG4gICAgICBpZiAoIXJlc29sdmVkKSB7XG4gICAgICAgIHJlc29sdmVkID0gdGhpcy5yZXNvbHZlVHlwaW5nRnJvbURpcmVjdG9yeShwYXRoLnBvc2l4LmpvaW4odGhpcy5iYXplbE9wdHMubm9kZU1vZHVsZXNQcmVmaXgsIG5hbWUpLCBmYWxzZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFR5cGVzIG5vdCByZXNvbHZlZCBzaG91bGQgYmUgc2lsZW50bHkgaWdub3JlZC4gTGVhdmUgaXQgdG8gVHlwZXNjcmlwdFxuICAgICAgLy8gdG8gZWl0aGVyIGVycm9yIG91dCB3aXRoIFwiVFMyNjg4OiBDYW5ub3QgZmluZCB0eXBlIGRlZmluaXRpb24gZmlsZSBmb3JcbiAgICAgIC8vICdmb28nXCIgb3IgZm9yIHRoZSBidWlsZCB0byBmYWlsIGR1ZSB0byBhIG1pc3NpbmcgdHlwZSB0aGF0IGlzIHVzZWQuXG4gICAgICBpZiAoIXJlc29sdmVkKSB7XG4gICAgICAgIGlmIChERUJVRykge1xuICAgICAgICAgIGRlYnVnKGBGYWlsZWQgdG8gcmVzb2x2ZSB0eXBlIHJlZmVyZW5jZSBkaXJlY3RpdmUgJyR7bmFtZX0nYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gSW4gdHlwZXNjcmlwdCAyLnggdGhlIHJldHVybiB0eXBlIGZvciB0aGlzIGZ1bmN0aW9uXG4gICAgICAvLyBpcyBgKHRzLlJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZSB8IHVuZGVmaW5lZClbXWAgdGh1cyB3ZSBhY3R1YWxseVxuICAgICAgLy8gZG8gYWxsb3cgcmV0dXJuaW5nIGB1bmRlZmluZWRgIGluIHRoZSBhcnJheSBidXQgdGhlIGZ1bmN0aW9uIGlzIHR5cGVkXG4gICAgICAvLyBgKHRzLlJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZSlbXWAgdG8gY29tcGlsZSB3aXRoIGJvdGggdHlwZXNjcmlwdFxuICAgICAgLy8gMi54IGFuZCAzLjAvMy4xIHdpdGhvdXQgZXJyb3IuIFR5cGVzY3JpcHQgMy4wLzMuMSBkbyBoYW5kbGUgdGhlIGB1bmRlZmluZWRgXG4gICAgICAvLyB2YWx1ZXMgaW4gdGhlIGFycmF5IGNvcnJlY3RseSBkZXNwaXRlIHRoZSByZXR1cm4gc2lnbmF0dXJlLlxuICAgICAgLy8gSXQgbG9va3MgbGlrZSB0aGUgcmV0dXJuIHR5cGUgY2hhbmdlIHdhcyBhIG1pc3Rha2UgYmVjYXVzZVxuICAgICAgLy8gaXQgd2FzIGNoYW5nZWQgYmFjayB0byBpbmNsdWRlIGB8IHVuZGVmaW5lZGAgcmVjZW50bHk6XG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vTWljcm9zb2Z0L1R5cGVTY3JpcHQvcHVsbC8yODA1OS5cbiAgICAgIHJlc3VsdC5wdXNoKHJlc29sdmVkIGFzIHRzLlJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8qKiBMb2FkcyBhIHNvdXJjZSBmaWxlIGZyb20gZGlzayAob3IgdGhlIGNhY2hlKS4gKi9cbiAgZ2V0U291cmNlRmlsZShcbiAgICAgIGZpbGVOYW1lOiBzdHJpbmcsIGxhbmd1YWdlVmVyc2lvbjogdHMuU2NyaXB0VGFyZ2V0LFxuICAgICAgb25FcnJvcj86IChtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gcGVyZlRyYWNlLndyYXAoYGdldFNvdXJjZUZpbGUgJHtmaWxlTmFtZX1gLCAoKSA9PiB7XG4gICAgICBjb25zdCBzZiA9IHRoaXMuZmlsZUxvYWRlci5sb2FkRmlsZShmaWxlTmFtZSwgZmlsZU5hbWUsIGxhbmd1YWdlVmVyc2lvbik7XG4gICAgICBpZiAoIS9cXC5kXFwudHN4PyQvLnRlc3QoZmlsZU5hbWUpICYmXG4gICAgICAgICAgKHRoaXMub3B0aW9ucy5tb2R1bGUgPT09IHRzLk1vZHVsZUtpbmQuQU1EIHx8XG4gICAgICAgICAgIHRoaXMub3B0aW9ucy5tb2R1bGUgPT09IHRzLk1vZHVsZUtpbmQuVU1EKSkge1xuICAgICAgICBjb25zdCBtb2R1bGVOYW1lID0gdGhpcy5hbWRNb2R1bGVOYW1lKHNmKTtcbiAgICAgICAgaWYgKHNmLm1vZHVsZU5hbWUgPT09IG1vZHVsZU5hbWUgfHwgIW1vZHVsZU5hbWUpIHJldHVybiBzZjtcbiAgICAgICAgaWYgKHNmLm1vZHVsZU5hbWUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgIGBFUlJPUjogJHtzZi5maWxlTmFtZX0gYCArXG4gICAgICAgICAgICAgIGBjb250YWlucyBhIG1vZHVsZSBuYW1lIGRlY2xhcmF0aW9uICR7c2YubW9kdWxlTmFtZX0gYCArXG4gICAgICAgICAgICAgIGB3aGljaCB3b3VsZCBiZSBvdmVyd3JpdHRlbiB3aXRoICR7bW9kdWxlTmFtZX0gYCArXG4gICAgICAgICAgICAgIGBieSBCYXplbCdzIFR5cGVTY3JpcHQgY29tcGlsZXIuYCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gU2V0dGluZyB0aGUgbW9kdWxlTmFtZSBpcyBlcXVpdmFsZW50IHRvIHRoZSBvcmlnaW5hbCBzb3VyY2UgaGF2aW5nIGFcbiAgICAgICAgLy8gLy8vPGFtZC1tb2R1bGUgbmFtZT1cInNvbWUvbmFtZVwiLz4gZGlyZWN0aXZlXG4gICAgICAgIHNmLm1vZHVsZU5hbWUgPSBtb2R1bGVOYW1lO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNmO1xuICAgIH0pO1xuICB9XG5cbiAgd3JpdGVGaWxlKFxuICAgICAgZmlsZU5hbWU6IHN0cmluZywgY29udGVudDogc3RyaW5nLCB3cml0ZUJ5dGVPcmRlck1hcms6IGJvb2xlYW4sXG4gICAgICBvbkVycm9yOiAoKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZCl8dW5kZWZpbmVkLFxuICAgICAgc291cmNlRmlsZXM6IFJlYWRvbmx5QXJyYXk8dHMuU291cmNlRmlsZT58dW5kZWZpbmVkKTogdm9pZCB7XG4gICAgcGVyZlRyYWNlLndyYXAoXG4gICAgICAgIGB3cml0ZUZpbGUgJHtmaWxlTmFtZX1gLFxuICAgICAgICAoKSA9PiB0aGlzLndyaXRlRmlsZUltcGwoXG4gICAgICAgICAgICBmaWxlTmFtZSwgY29udGVudCwgd3JpdGVCeXRlT3JkZXJNYXJrLCBvbkVycm9yLCBzb3VyY2VGaWxlcykpO1xuICB9XG5cbiAgd3JpdGVGaWxlSW1wbChcbiAgICAgIGZpbGVOYW1lOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZywgd3JpdGVCeXRlT3JkZXJNYXJrOiBib29sZWFuLFxuICAgICAgb25FcnJvcjogKChtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWQpfHVuZGVmaW5lZCxcbiAgICAgIHNvdXJjZUZpbGVzOiBSZWFkb25seUFycmF5PHRzLlNvdXJjZUZpbGU+fHVuZGVmaW5lZCk6IHZvaWQge1xuICAgIC8vIFdvcmthcm91bmQgaHR0cHM6Ly9naXRodWIuY29tL01pY3Jvc29mdC9UeXBlU2NyaXB0L2lzc3Vlcy8xODY0OFxuICAgIC8vIFRoaXMgYnVnIGlzIGZpeGVkIGluIFRTIDIuOVxuICAgIGNvbnN0IHZlcnNpb24gPSB0cy52ZXJzaW9uTWFqb3JNaW5vcjtcbiAgICBjb25zdCBbbWFqb3IsIG1pbm9yXSA9IHZlcnNpb24uc3BsaXQoJy4nKS5tYXAocyA9PiBOdW1iZXIocykpO1xuICAgIGNvbnN0IHdvcmthcm91bmROZWVkZWQgPSBtYWpvciA8PSAyICYmIG1pbm9yIDw9IDg7XG4gICAgaWYgKHdvcmthcm91bmROZWVkZWQgJiZcbiAgICAgICAgKHRoaXMub3B0aW9ucy5tb2R1bGUgPT09IHRzLk1vZHVsZUtpbmQuQU1EIHx8XG4gICAgICAgICB0aGlzLm9wdGlvbnMubW9kdWxlID09PSB0cy5Nb2R1bGVLaW5kLlVNRCkgJiZcbiAgICAgICAgZmlsZU5hbWUuZW5kc1dpdGgoJy5kLnRzJykgJiYgc291cmNlRmlsZXMgJiYgc291cmNlRmlsZXMubGVuZ3RoID4gMCAmJlxuICAgICAgICBzb3VyY2VGaWxlc1swXS5tb2R1bGVOYW1lKSB7XG4gICAgICBjb250ZW50ID1cbiAgICAgICAgICBgLy8vIDxhbWQtbW9kdWxlIG5hbWU9XCIke3NvdXJjZUZpbGVzWzBdLm1vZHVsZU5hbWV9XCIgLz5cXG4ke2NvbnRlbnR9YDtcbiAgICB9XG4gICAgZmlsZU5hbWUgPSB0aGlzLmZsYXR0ZW5PdXREaXIoZmlsZU5hbWUpO1xuXG4gICAgaWYgKHRoaXMuYmF6ZWxPcHRzLmlzSnNUcmFuc3BpbGF0aW9uKSB7XG4gICAgICBmaWxlTmFtZSA9IHRoaXMuYmF6ZWxPcHRzLnRyYW5zcGlsZWRKc091dHB1dEZpbGVOYW1lITtcbiAgICB9IGVsc2UgaWYgKCF0aGlzLmJhemVsT3B0cy5lczVNb2RlKSB7XG4gICAgICAvLyBXcml0ZSBFUzYgdHJhbnNwaWxlZCBmaWxlcyB0byAqLmNsb3N1cmUuanMuXG4gICAgICBpZiAodGhpcy5iYXplbE9wdHMubG9jYWxlKSB7XG4gICAgICAgIC8vIGkxOG4gcGF0aHMgYXJlIHJlcXVpcmVkIHRvIGVuZCB3aXRoIF9fbG9jYWxlLmpzIHNvIHdlIHB1dFxuICAgICAgICAvLyB0aGUgLmNsb3N1cmUgc2VnbWVudCBiZWZvcmUgdGhlIF9fbG9jYWxlXG4gICAgICAgIGZpbGVOYW1lID0gZmlsZU5hbWUucmVwbGFjZSgvKF9fW15cXC5dKyk/XFwuanMkLywgJy5jbG9zdXJlJDEuanMnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbGVOYW1lID0gZmlsZU5hbWUucmVwbGFjZSgvXFwuanMkLywgJy5jbG9zdXJlLmpzJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJlcGVuZCB0aGUgb3V0cHV0IGRpcmVjdG9yeS5cbiAgICBmaWxlTmFtZSA9IHBhdGguam9pbih0aGlzLm9wdGlvbnMub3V0RGlyLCBmaWxlTmFtZSk7XG5cbiAgICAvLyBPdXIgZmlsZSBjYWNoZSBpcyBiYXNlZCBvbiBtdGltZSAtIHNvIGF2b2lkIHdyaXRpbmcgZmlsZXMgaWYgdGhleVxuICAgIC8vIGRpZCBub3QgY2hhbmdlLlxuICAgIGlmICghZnMuZXhpc3RzU3luYyhmaWxlTmFtZSkgfHxcbiAgICAgICAgZnMucmVhZEZpbGVTeW5jKGZpbGVOYW1lLCAndXRmLTgnKSAhPT0gY29udGVudCkge1xuICAgICAgdGhpcy5kZWxlZ2F0ZS53cml0ZUZpbGUoXG4gICAgICAgICAgZmlsZU5hbWUsIGNvbnRlbnQsIHdyaXRlQnl0ZU9yZGVyTWFyaywgb25FcnJvciwgc291cmNlRmlsZXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtYW5jZSBvcHRpbWl6YXRpb246IGRvbid0IHRyeSB0byBzdGF0IGZpbGVzIHdlIHdlcmVuJ3QgZXhwbGljaXRseVxuICAgKiBnaXZlbiBhcyBpbnB1dHMuXG4gICAqIFRoaXMgYWxzbyBhbGxvd3MgdXMgdG8gZGlzYWJsZSBCYXplbCBzYW5kYm94aW5nLCB3aXRob3V0IGFjY2lkZW50YWxseVxuICAgKiByZWFkaW5nIC50cyBpbnB1dHMgd2hlbiAuZC50cyBpbnB1dHMgYXJlIGludGVuZGVkLlxuICAgKiBOb3RlIHRoYXQgaW4gd29ya2VyIG1vZGUsIHRoZSBmaWxlIGNhY2hlIHdpbGwgYWxzbyBndWFyZCBhZ2FpbnN0IGFyYml0cmFyeVxuICAgKiBmaWxlIHJlYWRzLlxuICAgKi9cbiAgZmlsZUV4aXN0cyhmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgLy8gVW5kZXIgQmF6ZWwsIHVzZXJzIGRvIG5vdCBkZWNsYXJlIGRlcHNbXSBvbiB0aGVpciBub2RlX21vZHVsZXMuXG4gICAgLy8gVGhpcyBtZWFucyB0aGF0IHdlIGRvIG5vdCBsaXN0IGFsbCB0aGUgbmVlZGVkIC5kLnRzIGZpbGVzIGluIHRoZSBmaWxlc1tdXG4gICAgLy8gc2VjdGlvbiBvZiB0c2NvbmZpZy5qc29uLCBhbmQgdGhhdCBpcyB3aGF0IHBvcHVsYXRlcyB0aGUga25vd25GaWxlcyBzZXQuXG4gICAgLy8gSW4gYWRkaXRpb24sIHRoZSBub2RlIG1vZHVsZSByZXNvbHZlciBtYXkgbmVlZCB0byByZWFkIHBhY2thZ2UuanNvbiBmaWxlc1xuICAgIC8vIGFuZCB0aGVzZSBhcmUgbm90IHBlcm1pdHRlZCBpbiB0aGUgZmlsZXNbXSBzZWN0aW9uLlxuICAgIC8vIFNvIHdlIHBlcm1pdCByZWFkaW5nIG5vZGVfbW9kdWxlcy8qIGZyb20gYWN0aW9uIGlucHV0cywgZXZlbiB0aG91Z2ggdGhpc1xuICAgIC8vIGNhbiBpbmNsdWRlIGRhdGFbXSBkZXBlbmRlbmNpZXMgYW5kIGlzIGJyb2FkZXIgdGhhbiB3ZSB3b3VsZCBsaWtlLlxuICAgIC8vIFRoaXMgc2hvdWxkIG9ubHkgYmUgZW5hYmxlZCB1bmRlciBCYXplbCwgbm90IEJsYXplLlxuICAgIGlmICh0aGlzLmFsbG93QWN0aW9uSW5wdXRSZWFkcyAmJiBmaWxlUGF0aC5pbmRleE9mKCcvbm9kZV9tb2R1bGVzLycpID49IDApIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuZmlsZUxvYWRlci5maWxlRXhpc3RzKGZpbGVQYXRoKTtcbiAgICAgIGlmIChERUJVRyAmJiAhcmVzdWx0ICYmIHRoaXMuZGVsZWdhdGUuZmlsZUV4aXN0cyhmaWxlUGF0aCkpIHtcbiAgICAgICAgZGVidWcoXCJQYXRoIGV4aXN0cywgYnV0IGlzIG5vdCByZWdpc3RlcmVkIGluIHRoZSBjYWNoZVwiLCBmaWxlUGF0aCk7XG4gICAgICAgIE9iamVjdC5rZXlzKCh0aGlzLmZpbGVMb2FkZXIgYXMgYW55KS5jYWNoZS5sYXN0RGlnZXN0cykuZm9yRWFjaChrID0+IHtcbiAgICAgICAgICBpZiAoay5lbmRzV2l0aChwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSkpIHtcbiAgICAgICAgICAgIGRlYnVnKFwiICBNYXliZSB5b3UgbWVhbnQgdG8gbG9hZCBmcm9tXCIsIGspO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5rbm93bkZpbGVzLmhhcyhmaWxlUGF0aCk7XG4gIH1cblxuICBnZXREZWZhdWx0TGliTG9jYXRpb24oKTogc3RyaW5nIHtcbiAgICAvLyBTaW5jZSB3ZSBvdmVycmlkZSBnZXREZWZhdWx0TGliRmlsZU5hbWUgYmVsb3csIHdlIG11c3QgYWxzbyBwcm92aWRlIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBjb250YWluaW5nIHRoZSBmaWxlLlxuICAgIC8vIE90aGVyd2lzZSBUeXBlU2NyaXB0IGxvb2tzIGluIEM6XFxsaWIueHh4LmQudHMgZm9yIHRoZSBkZWZhdWx0IGxpYi5cbiAgICByZXR1cm4gcGF0aC5kaXJuYW1lKFxuICAgICAgICB0aGlzLmdldERlZmF1bHRMaWJGaWxlTmFtZSh7dGFyZ2V0OiB0cy5TY3JpcHRUYXJnZXQuRVM1fSkpO1xuICB9XG5cbiAgZ2V0RGVmYXVsdExpYkZpbGVOYW1lKG9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyk6IHN0cmluZyB7XG4gICAgaWYgKHRoaXMuYmF6ZWxPcHRzLm5vZGVNb2R1bGVzUHJlZml4KSB7XG4gICAgICByZXR1cm4gcGF0aC5qb2luKFxuICAgICAgICAgIHRoaXMuYmF6ZWxPcHRzLm5vZGVNb2R1bGVzUHJlZml4LCAndHlwZXNjcmlwdC9saWInLFxuICAgICAgICAgIHRzLmdldERlZmF1bHRMaWJGaWxlTmFtZSh7dGFyZ2V0OiB0cy5TY3JpcHRUYXJnZXQuRVM1fSkpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5kZWxlZ2F0ZS5nZXREZWZhdWx0TGliRmlsZU5hbWUob3B0aW9ucyk7XG4gIH1cblxuICByZWFscGF0aChzOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIC8vIHRzYy13cmFwcGVkIHJlbGllcyBvbiBzdHJpbmcgbWF0Y2hpbmcgb2YgZmlsZSBwYXRocyBmb3IgdGhpbmdzIGxpa2UgdGhlXG4gICAgLy8gZmlsZSBjYWNoZSBhbmQgZm9yIHN0cmljdCBkZXBzIGNoZWNraW5nLlxuICAgIC8vIFR5cGVTY3JpcHQgd2lsbCB0cnkgdG8gcmVzb2x2ZSBzeW1saW5rcyBkdXJpbmcgbW9kdWxlIHJlc29sdXRpb24gd2hpY2hcbiAgICAvLyBtYWtlcyBvdXIgY2hlY2tzIGZhaWw6IHRoZSBwYXRoIHdlIHJlc29sdmVkIGFzIGFuIGlucHV0IGlzbid0IHRoZSBzYW1lXG4gICAgLy8gb25lIHRoZSBtb2R1bGUgcmVzb2x2ZXIgd2lsbCBsb29rIGZvci5cbiAgICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL01pY3Jvc29mdC9UeXBlU2NyaXB0L3B1bGwvMTIwMjBcbiAgICAvLyBTbyB3ZSBzaW1wbHkgdHVybiBvZmYgc3ltbGluayByZXNvbHV0aW9uLlxuICAgIHJldHVybiBzO1xuICB9XG5cbiAgLy8gRGVsZWdhdGUgZXZlcnl0aGluZyBlbHNlIHRvIHRoZSBvcmlnaW5hbCBjb21waWxlciBob3N0LlxuXG4gIGdldENhbm9uaWNhbEZpbGVOYW1lKHBhdGg6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmRlbGVnYXRlLmdldENhbm9uaWNhbEZpbGVOYW1lKHBhdGgpO1xuICB9XG5cbiAgZ2V0Q3VycmVudERpcmVjdG9yeSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmRlbGVnYXRlLmdldEN1cnJlbnREaXJlY3RvcnkoKTtcbiAgfVxuXG4gIHVzZUNhc2VTZW5zaXRpdmVGaWxlTmFtZXMoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuZGVsZWdhdGUudXNlQ2FzZVNlbnNpdGl2ZUZpbGVOYW1lcygpO1xuICB9XG5cbiAgZ2V0TmV3TGluZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmRlbGVnYXRlLmdldE5ld0xpbmUoKTtcbiAgfVxuXG4gIGdldERpcmVjdG9yaWVzKHBhdGg6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmRlbGVnYXRlLmdldERpcmVjdG9yaWVzKHBhdGgpO1xuICB9XG5cbiAgcmVhZEZpbGUoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ3x1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmRlbGVnYXRlLnJlYWRGaWxlKGZpbGVOYW1lKTtcbiAgfVxuXG4gIHRyYWNlKHM6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnNvbGUuZXJyb3Iocyk7XG4gIH1cbn1cbiJdfQ==