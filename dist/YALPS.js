import heap from "heap";
// Actual code starts here.
/**
 * Returns a `Constraint` that specifies something should be less than or equal to `value`.
 * Equivalent to `{ max: value }`.
 */
export const lessEq = (value) => ({ max: value });
/**
 * Returns a `Constraint` that specifies something should be greater than or equal to `value`.
 * Equivalent to `{ min: value }`.
 */
export const greaterEq = (value) => ({ min: value });
/**
 * Returns a `Constraint` that specifies something should be exactly equal to `value`.
 * Equivalent to `{ equal: value }`.
 */
export const equalTo = (value) => ({ equal: value });
/**
 * Returns a `Constraint` that specifies something should be between `lower` and `upper` (inclusive).
 * Equivalent to `{ min: lower, max: upper }`.
 */
export const inRange = (lower, upper) => ({
    max: upper,
    min: lower
});
/** Intended to be called internally. It gives the element at the row and col of the tableau. */
export const index = (tableau, row, col) => tableau.matrix[row * tableau.width + col];
/** Intended to be called internally. It overwrites the element at the row and col of the tableau. */
export const update = (tableau, row, col, value) => {
    tableau.matrix[row * tableau.width + col] = value;
};
const convertToIterable = (msg, seq) => {
    if (seq == null)
        throw `${msg} was null or undefined.`;
    if (typeof seq[Symbol.iterator] === "function")
        return seq;
    if (typeof seq === "object")
        return Object.entries(seq);
    throw `${msg} was not an object or iterable.`;
};
const convertToSet = (set) => set === true ? true
    : set === false ? new Set()
        : set instanceof Set ? set
            : new Set(set);
/** Intended to be called internally. It constructs a Tableau from a `Model`. */
export const tableauModel = (model) => {
    if (model.variables == null)
        throw "variables was null or undefined.";
    if (model.constraints == null)
        throw "constraints was null or undefined.";
    const sign = model.direction === "maximize" || model.direction == null ? 1
        : model.direction === "minimize" ? -1
            : 0;
    if (sign === 0)
        throw `'${model.direction}' is not a valid optimization direction. Should be 'maximize', 'minimize', or left blank.`;
    const variables = Array.isArray(model.variables) ? model.variables
        : typeof model.variables[Symbol.iterator] === "function" ? Array.from(model.variables)
            : typeof model.variables === "object" ? Object.entries(model.variables)
                : null;
    if (variables === null)
        throw "variables was not an object or iterable.";
    const binaryConstraintCol = [];
    const intVars = [];
    if (model.integers || model.binaries) {
        const binaryVariables = convertToSet(model.binaries);
        const integerVariables = binaryVariables === true ? true : convertToSet(model.integers);
        for (let i = 1; i <= variables.length; i++) {
            const [key,] = variables[i - 1];
            if (binaryVariables === true || binaryVariables.has(key)) {
                binaryConstraintCol.push(i);
                intVars.push(i);
            }
            else if (integerVariables === true || integerVariables.has(key)) {
                intVars.push(i);
            }
        }
    }
    const constraints = new Map();
    for (const [key, constraint] of convertToIterable("constraints", model.constraints)) {
        if (constraint == null)
            throw "A constraint was null or undefined.";
        const bounds = constraints.get(key) ?? { row: NaN, lower: -Infinity, upper: Infinity };
        bounds.lower = Math.max(bounds.lower, constraint.equal ?? constraint.min ?? -Infinity);
        bounds.upper = Math.min(bounds.upper, constraint.equal ?? constraint.max ?? Infinity);
        //if (rows.lower > rows.upper) return ["infeasible", NaN]
        if (!constraints.has(key))
            constraints.set(key, bounds);
    }
    let numConstraints = 1;
    for (const constraint of constraints.values()) {
        constraint.row = numConstraints;
        numConstraints +=
            (Number.isFinite(constraint.lower) ? 1 : 0)
                + (Number.isFinite(constraint.upper) ? 1 : 0);
    }
    const width = variables.length + 1;
    const height = numConstraints + binaryConstraintCol.length;
    const numVars = width + height;
    const tableau = {
        matrix: new Float64Array(width * height),
        width: width,
        height: height,
        positionOfVariable: new Int32Array(numVars),
        variableAtPosition: new Int32Array(numVars)
    };
    for (let i = 0; i < numVars; i++) {
        tableau.positionOfVariable[i] = i;
        tableau.variableAtPosition[i] = i;
    }
    const hasObjective = "objective" in model;
    for (let c = 1; c < width; c++) {
        for (const [constraint, coef] of convertToIterable("A variable", variables[c - 1][1])) {
            if (hasObjective && constraint === model.objective) {
                update(tableau, 0, c, sign * coef);
            }
            const bounds = constraints.get(constraint);
            if (bounds != null) {
                if (Number.isFinite(bounds.upper)) {
                    update(tableau, bounds.row, c, coef);
                    if (Number.isFinite(bounds.lower)) {
                        update(tableau, bounds.row + 1, c, -coef);
                    }
                }
                else if (Number.isFinite(bounds.lower)) {
                    update(tableau, bounds.row, c, -coef);
                }
            }
        }
    }
    for (const bounds of constraints.values()) {
        if (Number.isFinite(bounds.upper)) {
            update(tableau, bounds.row, 0, bounds.upper);
            if (Number.isFinite(bounds.lower)) {
                update(tableau, bounds.row + 1, 0, -bounds.lower);
            }
        }
        else if (Number.isFinite(bounds.lower)) {
            update(tableau, bounds.row, 0, -bounds.lower);
        }
    }
    for (let b = 0; b < binaryConstraintCol.length; b++) {
        const row = numConstraints + b;
        update(tableau, row, 0, 1);
        update(tableau, row, binaryConstraintCol[b], 1);
    }
    return {
        tableau: tableau,
        sign: sign,
        variables: variables,
        integers: intVars
    };
};
const pivot = (tableau, row, col) => {
    const quotient = index(tableau, row, col);
    const leaving = tableau.variableAtPosition[tableau.width + row];
    const entering = tableau.variableAtPosition[col];
    tableau.variableAtPosition[tableau.width + row] = entering;
    tableau.variableAtPosition[col] = leaving;
    tableau.positionOfVariable[leaving] = col;
    tableau.positionOfVariable[entering] = tableau.width + row;
    const nonZeroColumns = [];
    // (1 / quotient) * R_pivot -> R_pivot
    for (let c = 0; c < tableau.width; c++) {
        const value = index(tableau, row, c);
        if (Math.abs(value) > 1E-16) {
            update(tableau, row, c, value / quotient);
            nonZeroColumns.push(c);
        }
        else {
            update(tableau, row, c, 0);
        }
    }
    update(tableau, row, col, 1 / quotient);
    // -M[r, col] * R_pivot + R_r -> R_r
    for (let r = 0; r < tableau.height; r++) {
        if (r === row)
            continue;
        const coef = index(tableau, r, col);
        if (Math.abs(coef) > 1E-16) {
            for (let i = 0; i < nonZeroColumns.length; i++) {
                const c = nonZeroColumns[i];
                update(tableau, r, c, index(tableau, r, c) - coef * index(tableau, row, c));
            }
            update(tableau, r, col, -coef / quotient);
        }
    }
};
// Checks if the simplex method has encountered a cycle.
const hasCycle = (history, tableau, row, col) => {
    // This seems somewhat inefficient,
    // but there was little or no noticable impact in most benchmarks.
    history.push([tableau.variableAtPosition[tableau.width + row], tableau.variableAtPosition[col]]);
    for (let length = 1; length <= Math.floor(history.length / 2); length++) {
        let cycle = true;
        for (let i = 0; i < length; i++) {
            const item = history.length - 1 - i;
            const [row1, col1] = history[item];
            const [row2, col2] = history[item - length];
            if (row1 !== row2 || col1 !== col2) {
                cycle = false;
                break;
            }
        }
        if (cycle)
            return true;
    }
    return false;
};
const roundToPrecision = (num, precision) => {
    const rounding = Math.round(1 / precision);
    return Math.round((num + Number.EPSILON) * rounding) / rounding;
};
// Finds the optimal solution given some basic feasible solution.
const phase2 = (tableau, options) => {
    const pivotHistory = [];
    const precision = options.precision;
    for (let iter = 0; iter < options.maxPivots; iter++) {
        // Find the entering column/variable
        let col = 0;
        let value = precision;
        for (let c = 1; c < tableau.width; c++) {
            const reducedCost = index(tableau, 0, c);
            if (reducedCost > value) {
                value = reducedCost;
                col = c;
            }
        }
        if (col === 0)
            return ["optimal", roundToPrecision(index(tableau, 0, 0), precision)];
        // Find the leaving row/variable
        let row = 0;
        let minRatio = Infinity;
        for (let r = 1; r < tableau.height; r++) {
            const value = index(tableau, r, col);
            if (Math.abs(value) <= precision)
                continue;
            const rhs = index(tableau, r, 0);
            if (Math.abs(rhs) <= precision && value > 0) {
                row = r;
                break;
            }
            const ratio = rhs / value;
            if (precision < ratio && ratio < minRatio) {
                minRatio = ratio;
                row = r;
            }
        }
        if (row === 0)
            return ["unbounded", col];
        if (options.checkCycles && hasCycle(pivotHistory, tableau, row, col))
            return ["cycled", NaN];
        pivot(tableau, row, col);
    }
    return ["cycled", NaN];
};
// Transforms a tableau into a basic feasible solution.
const phase1 = (tableau, options) => {
    const pivotHistory = [];
    const precision = options.precision;
    for (let iter = 0; iter < options.maxPivots; iter++) {
        // Find the leaving row/variable
        let row = 0;
        let rhs = -precision;
        for (let r = 1; r < tableau.height; r++) {
            const value = index(tableau, r, 0);
            if (value < rhs) {
                rhs = value;
                row = r;
            }
        }
        if (row === 0)
            return phase2(tableau, options);
        // Find the entering column/variable
        let col = 0;
        let maxRatio = -Infinity;
        for (let c = 1; c < tableau.width; c++) {
            const coefficient = index(tableau, row, c);
            if (coefficient < -precision) {
                const ratio = -index(tableau, 0, c) / coefficient;
                if (ratio > maxRatio) {
                    maxRatio = ratio;
                    col = c;
                }
            }
        }
        if (col === 0)
            return ["infeasible", NaN];
        if (options.checkCycles && hasCycle(pivotHistory, tableau, row, col))
            return ["cycled", NaN];
        pivot(tableau, row, col);
    }
    return ["cycled", NaN];
};
// Creates a solution object representing the optimal solution (if any).
const solution = (tabmod, status, result, precision) => {
    if (status === "optimal" || (status === "timedout" && !Number.isNaN(result))) {
        const variables = [];
        for (let i = 0; i < tabmod.variables.length; i++) {
            const row = tabmod.tableau.positionOfVariable[i + 1] - tabmod.tableau.width;
            if (row < 0)
                continue; // variable is not in the solution
            const value = index(tabmod.tableau, row, 0);
            if (value > precision) {
                variables.push([tabmod.variables[i][0], roundToPrecision(value, precision)]);
            }
        }
        return {
            status: status,
            result: -tabmod.sign * result,
            variables: variables
        };
    }
    else if (status === "unbounded") {
        const variable = tabmod.tableau.variableAtPosition[result] - 1;
        return {
            status: "unbounded",
            result: tabmod.sign * Infinity,
            variables: 0 <= variable && variable < tabmod.variables.length
                ? [[tabmod.variables[variable][0], Infinity]]
                : []
        };
    }
    else {
        // infeasible | cycled | (timedout and result is NaN)
        return {
            status: status,
            result: NaN,
            variables: []
        };
    }
};
const buffer = (matrixLength, posVarLength) => ({
    matrix: new Float64Array(matrixLength),
    positionOfVariable: new Int32Array(posVarLength),
    variableAtPosition: new Int32Array(posVarLength)
});
// Creates a new tableau with additional cut constraints from a buffer.
const applyCuts = (tableau, { matrix, positionOfVariable, variableAtPosition }, cuts) => {
    matrix.set(tableau.matrix);
    for (let i = 0; i < cuts.length; i++) {
        const [sign, variable, value] = cuts[i];
        const r = (tableau.height + i) * tableau.width;
        const pos = tableau.positionOfVariable[variable];
        if (pos < tableau.width) {
            matrix[r] = sign * value;
            matrix.fill(0, r + 1, r + tableau.width);
            matrix[r + pos] = sign;
        }
        else {
            const row = (pos - tableau.width) * tableau.width;
            matrix[r] = sign * (value - matrix[row]);
            for (let c = 1; c < tableau.width; c++) {
                matrix[r + c] = -sign * matrix[row + c];
            }
        }
    }
    positionOfVariable.set(tableau.positionOfVariable);
    variableAtPosition.set(tableau.variableAtPosition);
    const length = tableau.width + tableau.height + cuts.length;
    for (let i = tableau.width + tableau.height; i < length; i++) {
        positionOfVariable[i] = i;
        variableAtPosition[i] = i;
    }
    return {
        matrix: matrix.subarray(0, tableau.matrix.length + tableau.width * cuts.length),
        width: tableau.width,
        height: tableau.height + cuts.length,
        positionOfVariable: positionOfVariable.subarray(0, length),
        variableAtPosition: variableAtPosition.subarray(0, length)
    };
};
// Finds the integer variable with the most fractional value.
const mostFractionalVar = (tableau, intVars) => {
    let highestFrac = 0;
    let variable = 0;
    let value = 0;
    for (let i = 0; i < intVars.length; i++) {
        const intVar = intVars[i];
        const row = tableau.positionOfVariable[intVar] - tableau.width;
        if (row < 0)
            continue;
        const val = index(tableau, row, 0);
        const frac = Math.abs(val - Math.round(val));
        if (frac > highestFrac) {
            highestFrac = frac;
            variable = intVar;
            value = val;
        }
    }
    return [variable, value, highestFrac];
};
// Runs the branch and cut algorithm to solve an integer problem.
// Requires the non-integer solution as input.
const branchAndCut = (tabmod, initResult, options) => {
    const [initVariable, initValue, initFrac] = mostFractionalVar(tabmod.tableau, tabmod.integers);
    if (initFrac <= options.precision) {
        // Wow, the initial solution is integer
        return solution(tabmod, "optimal", initResult, options.precision);
    }
    const branches = new heap((x, y) => x[0] - y[0]);
    branches.push([initResult, [[-1, initVariable, Math.ceil(initValue)]]]);
    branches.push([initResult, [[1, initVariable, Math.floor(initValue)]]]);
    // Set aside arrays/buffers to be reused over the course of the algorithm.
    // One set of buffers stores the state of the currrent best solution.
    // The other is used to solve the current candidate solution.
    // The two buffers are "swapped" once a new best solution is found.
    const maxExtraRows = tabmod.integers.length * 2;
    const matrixLength = tabmod.tableau.matrix.length + maxExtraRows * tabmod.tableau.width;
    const posVarLength = tabmod.tableau.positionOfVariable.length + maxExtraRows;
    const bufferA = buffer(matrixLength, posVarLength);
    const bufferB = buffer(matrixLength, posVarLength);
    let currentBuffer = true;
    const optimalThreshold = initResult * (1 - tabmod.sign * options.tolerance);
    const timeout = options.timeout + Date.now();
    let timedout = Date.now() >= timeout; // in case options.timeout <= 0
    let solutionFound = false;
    let bestEval = Infinity;
    let bestTableau = tabmod.tableau;
    let iter = 0;
    while (iter < options.maxIterations
        && !branches.empty()
        && bestEval >= optimalThreshold
        && !timedout) {
        const [relaxedEval, cuts] = branches.pop();
        if (relaxedEval > bestEval)
            break; // the remaining branches are worse than the current best solution
        const tableau = applyCuts(tabmod.tableau, currentBuffer ? bufferA : bufferB, cuts);
        const [status, result] = phase1(tableau, options);
        // The initial tableau is not unbounded and adding more cuts/constraints cannot make it become unbounded
        // assert(status !== "unbounded")
        if (status === "optimal" && result < bestEval) {
            const [variable, value, frac] = mostFractionalVar(tableau, tabmod.integers);
            if (frac <= options.precision) {
                // The solution is integer
                solutionFound = true;
                bestEval = result;
                bestTableau = tableau;
                currentBuffer = !currentBuffer;
            }
            else {
                const cutsUpper = [];
                const cutsLower = [];
                for (let i = 0; i < cuts.length; i++) {
                    const cut = cuts[i];
                    const [dir, v,] = cut;
                    if (v === variable) {
                        dir < 0 ? cutsLower.push(cut) : cutsUpper.push(cut);
                    }
                    else {
                        cutsUpper.push(cut);
                        cutsLower.push(cut);
                    }
                }
                cutsLower.push([1, variable, Math.floor(value)]);
                cutsUpper.push([-1, variable, Math.ceil(value)]);
                branches.push([result, cutsUpper]);
                branches.push([result, cutsLower]);
            }
        }
        // Otherwise, this branch's result is worse than the current best solution.
        // This could be because result is NaN (this branch is infeasible or cycled).
        // Either way, skip this branch and see if any other branches have a valid, better solution.
        timedout = Date.now() >= timeout;
        iter++;
    }
    // Did the solver "timeout"?
    const unfinished = !branches.empty()
        && bestEval < optimalThreshold
        && (timedout || iter === options.maxIterations);
    return solution({ ...tabmod, tableau: bestTableau }, unfinished ? "timedout"
        : !solutionFound ? "infeasible"
            : "optimal", solutionFound ? bestEval : NaN, options.precision);
};
/**
 * The initial, default options for the solver.
 * Can be used to reset `defaultOptions`.
 * Do not try to mutate this object - it is frozen.
*/
export const backupDefaultOptions = Object.freeze({
    precision: 1E-08,
    checkCycles: false,
    maxPivots: 8192,
    tolerance: 0,
    timeout: Infinity,
    maxIterations: 32768
});
/**
 * The default options used by the solver.
 * You may change these so that you do not have to
 * pass a custom `Options` object every time you call `solve`.
 */
export let defaultOptions = { ...backupDefaultOptions };
/**
 * Runs the solver on the given model and using the given options (if any).
 * @see `Model` on how to specify/create the model.
 * @see `Options` for the kinds of options available.
 * @see `Solution` as well for more detailed information on what is returned.
 */
export const solve = (model, options) => {
    if (model == null)
        throw "model was null or undefined.";
    const tabmod = tableauModel(model);
    const opt = { ...backupDefaultOptions, ...defaultOptions, ...options };
    const [status, result] = phase1(tabmod.tableau, opt);
    return (
    // Non-integer problem, return the simplex result.
    tabmod.integers.length === 0 ? solution(tabmod, status, result, opt.precision)
        // Integer problem, run branchAndCut using the valid simplex result.
        : status === "optimal" ? branchAndCut(tabmod, result, opt)
            // The problem has integer variables, but the initial solution is either:
            // 1) unbounded | infeasible => all branches will also be unbounded | infeasible
            // 2) cycled => cannot get an initial solution, return invalid solution
            : solution(tabmod, status, result, opt.precision));
};
