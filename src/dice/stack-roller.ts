import type { LexicalToken } from "./lexer";
import { Roller, RenderableRoller } from "./roller";
import { DiceRoller, setBasicStackRollerClass } from "./dice-roller";
import { FudgeRoller } from "./fudge-roller";
import { PercentRoller } from "./percent-roller";
import { StuntRoller } from "./stunt-roller";

export class BasicStackRoller extends Roller<number> {
    constructor(public lexemes: LexicalToken[]) {
        super();
    }
    declare result: number;
    operators: Record<string, (...args: number[]) => number> = {
        "+": (a: number, b: number): number => a + b,
        "-": (a: number, b: number): number => a - b,
        "*": (a: number, b: number): number => a * b,
        "/": (a: number, b: number): number => a / b,
        "^": (a: number, b: number): number => {
            return Math.pow(a, b);
        }
    };
    stack: DiceRoller[] = [];
    stackCopy: Array<DiceRoller | string> = [];
    stunted: string = "";
    dice: DiceRoller[] = [];
    async roll() {
        return this.rollSync();
    }
    rollSync() {
        this.stunted = "";
        this.parseLexemes();
        const final = this.stack.pop()!;
        final.rollSync();
        if (final instanceof StuntRoller) {
            if (final.doubles) {
                this.stunted = ` - ${final.results.get(0)!.value} Stunt Points`;
            }
        }
        this.result = final.result;
        return this.result;
    }
    parseLexemes() {
        let index = 0;
        for (const dice of this.lexemes) {
            switch (dice.type) {
                case "+":
                case "-":
                case "*":
                case "/":
                case "^":
                case "math": {
                    let b = this.stack.pop()!,
                        a = this.stack.pop()!;

                    b.rollSync();
                    if (b instanceof StuntRoller) {
                        if (b.doubles) {
                            this.stunted = ` - ${
                                b.results.get(0)!.value
                            } Stunt Points`;
                        }
                    }

                    a.rollSync();
                    if (a instanceof StuntRoller) {
                        if (a.doubles) {
                            this.stunted = ` - ${
                                a.results.get(0)!.value
                            } Stunt Points`;
                        }
                    }
                    const result = this.operators[dice.value](
                        a.result,
                        b.result
                    );

                    this.stackCopy.push(dice.value);
                    this.stack.push(new DiceRoller(`${result}`, dice));
                    break;
                }
                case "u": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    diceInstance.modifiers.set("u", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "kh": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    diceInstance.modifiers.set("kh", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "dl": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    data = diceInstance.rolls - data;

                    diceInstance.modifiers.set("kh", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "kl": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    diceInstance.modifiers.set("kl", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "dh": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    data = diceInstance.rolls - data;

                    diceInstance.modifiers.set("kl", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "!": {
                    let diceInstance = this.dice[index - 1];
                    let data = Number(dice.value) || 1;

                    diceInstance.modifiers.set("!", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.text ?? ""
                    });

                    break;
                }
                case "!!": {
                    let diceInstance = this.dice[index - 1];
                    let data = Number(dice.value) || 1;

                    diceInstance.modifiers.set("!!", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.text ?? ""
                    });

                    break;
                }
                case "r": {
                    let diceInstance = this.dice[index - 1];
                    let data = Number(dice.value) || 1;

                    diceInstance.modifiers.set("r", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "sort": {
                    let diceInstance = this.dice[index - 1];
                    let data = Number(dice.value);

                    diceInstance.modifiers.set("sort", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.value
                    });
                    break;
                }
                case "dice": {
                    if (
                        dice.parenedDice &&
                        /^d/.test(dice.value) &&
                        this.stack.length
                    ) {
                        const previous = this.stack.pop()!;
                        dice.value = `${previous.result}${dice.value}`;
                        this.dice[index] = new DiceRoller(dice.value, dice);
                    }
                    if (!this.dice[index]) {
                        this.dice[index] = new DiceRoller(dice.value, dice);
                    }

                    this.stack.push(this.dice[index]);
                    this.stackCopy.push(this.dice[index]);
                    index++;
                    break;
                }
                case "fudge": {
                    if (!this.dice[index]) {
                        this.dice[index] = new FudgeRoller(dice.value, dice);
                    }

                    this.stack.push(this.dice[index]);
                    this.stackCopy.push(this.dice[index]);
                    index++;
                    break;
                }
                case "stunt": {
                    if (!this.dice[index]) {
                        this.dice[index] = new StuntRoller(dice.value, dice);
                    }

                    this.stack.push(this.dice[index]);
                    this.stackCopy.push(this.dice[index]);
                    index++;
                    break;
                }

                case "%": {
                    if (!this.dice[index]) {
                        this.dice[index] = new PercentRoller(dice.value, dice);
                    }

                    this.stack.push(this.dice[index]);
                    this.stackCopy.push(this.dice[index]);
                    index++;
                    break;
                }
            }
        }
    }
}

export class StackRoller extends RenderableRoller<number> {
    private _result: number = 0;
    stunted: string = "";

    constructor(public override lexemes: LexicalToken[]) {
        super();
    }

    get result(): number {
        return this._result;
    }

    operators: Record<string, (...args: number[]) => number> = {
        "+": (a: number, b: number): number => a + b,
        "-": (a: number, b: number): number => a - b,
        "*": (a: number, b: number): number => a * b,
        "/": (a: number, b: number): number => a / b,
        "^": (a: number, b: number): number => {
            return Math.pow(a, b);
        }
    };
    stack: DiceRoller[] = [];
    maxStack: number[] = [];
    minStack: number[] = [];
    stackCopy: Array<DiceRoller | string> = [];
    override children: DiceRoller[] = [];
    hasRunOnce = false;

    max = Number.MIN_VALUE;
    min = Number.MAX_VALUE;

    rollSync() {
        this.stunted = "";
        this.buildDiceTree();
        for (const dice of this.children) {
            dice.rollSync();
        }
        this.calculate();
        this.hasRunOnce = true;
        return this._result;
    }

    buildDiceTree() {
        let index = 0;
        for (const dice of this.lexemes) {
            switch (dice.type) {
                case "+":
                case "*":
                case "/":
                case "^":
                case "-":
                case "math": {
                    continue;
                }
                case "u": {
                    let diceInstance = this.children[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    diceInstance.modifiers.set("u", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "kh": {
                    let diceInstance = this.children[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    diceInstance.modifiers.set("kh", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "dl": {
                    let diceInstance = this.children[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    data = diceInstance.rolls - data;

                    diceInstance.modifiers.set("kh", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "kl": {
                    let diceInstance = this.children[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    diceInstance.modifiers.set("kl", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "dh": {
                    let diceInstance = this.children[index - 1];
                    let data = dice.value ? Number(dice.value) : 1;

                    data = diceInstance.rolls - data;

                    diceInstance.modifiers.set("kl", {
                        data,
                        conditionals: [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "!": {
                    let diceInstance = this.children[index - 1];
                    let data = Number(dice.value) || 1;

                    diceInstance.modifiers.set("!", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.text ?? ""
                    });

                    break;
                }
                case "!!": {
                    let diceInstance = this.children[index - 1];
                    let data = Number(dice.value) || 1;

                    diceInstance.modifiers.set("!!", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.text ?? ""
                    });

                    break;
                }
                case "r": {
                    let diceInstance = this.children[index - 1];
                    let data = Number(dice.value) || 1;

                    diceInstance.modifiers.set("r", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.text ?? ""
                    });
                    break;
                }
                case "sort": {
                    let diceInstance = this.children[index - 1];
                    let data = Number(dice.value);

                    diceInstance.modifiers.set("sort", {
                        data,
                        conditionals: dice.conditions ?? [],
                        value: dice.value
                    });
                    break;
                }
                case "dice": {
                    if (
                        dice.parenedDice &&
                        /^d/.test(dice.value) &&
                        this.stack.length
                    ) {
                        const previous = this.stack.pop()!;
                        dice.value = `${previous.result}${dice.value}`;
                        this.children[index] = new DiceRoller(dice.value, dice);
                    }
                    if (!this.children[index]) {
                        this.children[index] = new DiceRoller(dice.value, dice);
                    }

                    index++;
                    break;
                }

                case "fudge": {
                    if (!this.children[index]) {
                        this.children[index] = new FudgeRoller(
                            dice.value,
                            dice
                        );
                    }
                    index++;
                    break;
                }
                case "stunt": {
                    if (!this.children[index]) {
                        this.children[index] = new StuntRoller(
                            dice.value,
                            dice
                        );
                    }
                    index++;
                    break;
                }

                case "%": {
                    if (!this.children[index]) {
                        this.children[index] = new PercentRoller(
                            dice.value,
                            dice
                        );
                    }
                    index++;
                    break;
                }
            }
        }
    }

    async roll(render?: boolean) {
        this.stunted = "";
        this.stackCopy = [];
        if (!this.children.length) {
            this.buildDiceTree();
        }
        const shouldAnimate = render || (this.shouldRender && this.hasRunOnce);
        this.children.forEach((dice) => (dice.shouldRender = shouldAnimate));
        for (const dice of this.children) {
            await dice.roll();
        }
        this.calculate();
        this.hasRunOnce = true;
        return this._result;
    }

    calculate() {
        this.stack = [];
        this.maxStack = [];
        this.minStack = [];
        this.stackCopy = [];
        let index = 0;
        for (const dice of this.lexemes) {
            switch (dice.type) {
                case "+":
                case "-":
                case "*":
                case "/":
                case "^":
                case "math": {
                    let b = this.stack.pop()!,
                        a = this.stack.pop()!;

                    if (b instanceof StuntRoller) {
                        if (b.doubles) {
                            this.stunted = ` - ${
                                b.results.get(0)!.value
                            } Stunt Points`;
                        }
                    }
                    if (a instanceof StuntRoller) {
                        if (a.doubles) {
                            this.stunted = ` - ${
                                a.results.get(0)!.value
                            } Stunt Points`;
                        }
                    }
                    const result = this.operators[dice.value](
                        a.result,
                        b.result
                    );

                    const min = this.operators[dice.value](
                        this.minStack.pop()!,
                        this.minStack.pop()!
                    );
                    const max = this.operators[dice.value](
                        this.maxStack.pop()!,
                        this.maxStack.pop()!
                    );

                    this.stackCopy.push(dice.value);
                    this.stack.push(new DiceRoller(`${result}`, dice));
                    this.minStack.push(min);
                    this.maxStack.push(max);
                    break;
                }
                case "stunt":
                case "fudge":
                case "%":
                case "dice": {
                    this.stack.push(this.children[index]);
                    this.stackCopy.push(this.children[index]);
                    this.minStack.push(this.children[index].getMinPossible());
                    this.maxStack.push(this.children[index].getMaxPossible());
                    index++;
                }
                default: {
                    continue;
                }
            }
        }
        const final = this.stack.pop();
        this.min = this.minStack.pop() ?? Number.MAX_VALUE;
        this.max = this.maxStack.pop() ?? Number.MIN_VALUE;
        if (final instanceof StuntRoller) {
            if (final.doubles) {
                this.stunted = ` - ${final.stunt.result} Stunt Points`;
            }
        }
        this._result = final?.result ?? 0;
    }
}

setBasicStackRollerClass(BasicStackRoller);
