<?php

declare(strict_types=1);

namespace App\FullTest;

// ── Imports ───────────────────────────────────────────────────────────────────

use DateTime;
use DateTimeImmutable;
use DateTimeInterface;
use Exception;
use RuntimeException;
use InvalidArgumentException;
use LogicException;
use ArrayAccess;
use ArrayIterator;
use Countable;
use IteratorAggregate;
use Traversable;
use Stringable;
use Closure;
use Generator;
use Fiber;
use WeakReference;
use SplStack;
use SplQueue;
use SplDoublyLinkedList;
use function array_map;
use function array_filter;
use const PHP_EOL;
use const PHP_INT_MAX;

// ── Global Constants ──────────────────────────────────────────────────────────

const APP_VERSION   = '3.0.0';
const APP_DEBUG     = false;
const APP_TIMEZONE  = 'UTC';
const MAX_RETRIES   = 3;
const PI_APPROX     = 3.14159265358979;
const EMPTY_ARRAY   = [];
const NULL_VALUE    = null;

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * Basic interface with constants and methods
 */
interface Identifiable
{
    public const VERSION = '1.0';
    public const MAX_ID  = PHP_INT_MAX;

    public function getId(): int;
    public function getUuid(): string;
}

/**
 * Interface extending multiple interfaces
 */
interface EntityInterface extends Identifiable, Stringable
{
    public function toArray(): array;
    public function fromArray(array $data): static;
}

/**
 * Generic-style docblock interface
 *
 * @template T of object
 */
interface RepositoryInterface
{
    /** @param int $id */
    public function find(int $id): ?object;

    /** @param T $entity */
    public function save(object $entity): bool;

    public function delete(int $id): bool;

    /** @return T[] */
    public function findAll(): array;

    /** @return iterable<T> */
    public function cursor(): iterable;
}

/**
 * Interface with all PHP 8 return types
 */
interface TypeShowcase
{
    public function returnsNever(): never;
    public function returnsMixed(): mixed;
    public function returnsStatic(): static;
    public function returnsSelf(): self;
    public function returnsVoid(): void;
    public function returnsNullable(): ?string;
    public function returnsUnion(): string|int|float;
    public function returnsIntersection(): Countable&IteratorAggregate;
    public function returnsNullableUnion(): string|int|null;
}

// ── Traits ────────────────────────────────────────────────────────────────────

/**
 * Trait with properties and all visibility levels
 */
trait TimestampTrait
{
    private ?DateTime $createdAt = null;
    protected ?DateTime $updatedAt = null;

    public function getCreatedAt(): ?DateTime
    {
        return $this->createdAt;
    }

    public function setCreatedAt(DateTime $dt): void
    {
        $this->createdAt = $dt;
    }

    protected function touch(): void
    {
        $this->updatedAt = new DateTime();
    }

    private function resetTimestamps(): void
    {
        $this->createdAt = null;
        $this->updatedAt = null;
    }
}

/**
 * Trait with abstract method
 */
trait LoggableTrait
{
    private string $logPrefix = 'APP';
    private static int $logCount = 0;

    abstract protected function getLogChannel(): string;

    public function log(string $level, string $message): void
    {
        self::$logCount++;
        echo "[{$this->logPrefix}][{$level}] {$message}" . PHP_EOL;
    }

    public static function getLogCount(): int
    {
        return self::$logCount;
    }
}

/**
 * Trait using another trait
 */
trait AuditTrait
{
    use TimestampTrait;
    use LoggableTrait;

    private array $changelog = [];

    public function recordChange(string $field, mixed $old, mixed $new): void
    {
        $this->changelog[] = compact('field', 'old', 'new');
        $this->touch();
    }
}

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * Unit enum (no backing type)
 */
enum Direction
{
    case NORTH;
    case SOUTH;
    case EAST;
    case WEST;

    public function opposite(): self
    {
        return match ($this) {
            Direction::NORTH => Direction::SOUTH,
            Direction::SOUTH => Direction::NORTH,
            Direction::EAST  => Direction::WEST,
            Direction::WEST  => Direction::EAST,
        };
    }

    public function label(): string
    {
        return strtolower($this->name);
    }
}

/**
 * String-backed enum implementing interface
 */
enum Status: string implements Stringable
{
    case DRAFT     = 'draft';
    case PENDING   = 'pending';
    case ACTIVE    = 'active';
    case SUSPENDED = 'suspended';
    case DELETED   = 'deleted';

    public const DEFAULT = self::DRAFT;

    public function label(): string
    {
        return ucfirst($this->value);
    }

    public function isTerminal(): bool
    {
        return $this === self::DELETED;
    }

    public function __toString(): string
    {
        return $this->value;
    }

    public static function fromLabel(string $label): self
    {
        foreach (self::cases() as $case) {
            if ($case->label() === $label) return $case;
        }
        throw new ValueError("Invalid label: {$label}");
    }
}

/**
 * Integer-backed enum
 */
enum Priority: int
{
    case LOW    = 1;
    case MEDIUM = 5;
    case HIGH   = 10;
    case URGENT = 100;

    public function isHigherThan(self $other): bool
    {
        return $this->value > $other->value;
    }
}

// ── PHP 8 Attributes ──────────────────────────────────────────────────────────

#[\Attribute(\Attribute::TARGET_CLASS)]
class Entity
{
    public function __construct(
        public readonly string $table,
        public readonly bool   $timestamps = true,
    ) {}
}

#[\Attribute(\Attribute::TARGET_METHOD | \Attribute::TARGET_FUNCTION)]
class Route
{
    public function __construct(
        public readonly string $path,
        public readonly string $method    = 'GET',
        public readonly array  $middleware = [],
    ) {}
}

#[\Attribute(\Attribute::TARGET_PROPERTY)]
class Column
{
    public function __construct(
        public readonly string  $name,
        public readonly string  $type    = 'string',
        public readonly bool    $nullable = false,
        public readonly ?int    $length   = null,
    ) {}
}

#[\Attribute(\Attribute::TARGET_PARAMETER)]
class Validate
{
    public function __construct(
        public readonly string $rule,
        public readonly string $message = '',
    ) {}
}

// ── Abstract Classes ──────────────────────────────────────────────────────────

/**
 * Abstract base with all modifier combinations
 */
abstract class BaseModel
{
    // Constants: all visibility levels, final
    public    const  SCHEMA_VERSION  = 1;
    protected const  SOFT_DELETE     = true;
    private   const  INTERNAL_KEY    = '_base';
    final     public const IMMUTABLE = false;

    // Static properties
    public    static int     $instanceCount = 0;
    protected static ?string $defaultScope  = null;
    private   static array   $registry      = [];

    // Instance properties: all visibility × modifiers
    public    int      $id       = 0;
    protected string   $type     = 'base';
    private   bool     $booted   = false;

    public    readonly string $uid;
    protected readonly int    $createdTimestamp;

    public    ?DateTime $deletedAt  = null;
    protected array     $attributes = [];
    private   mixed     $raw        = null;

    // Typed union property (PHP 8)
    public string|int|null $externalId = null;

    public function __construct()
    {
        $this->uid               = uniqid('model_', true);
        $this->createdTimestamp  = time();
        self::$instanceCount++;
        static::boot();
    }

    public function __destruct()
    {
        self::$instanceCount--;
    }

    public function __clone()
    {
        $this->uid = uniqid('clone_', true);
    }

    public function __toString(): string
    {
        return static::class . '#' . $this->id;
    }

    public function __debugInfo(): array
    {
        return ['id' => $this->id, 'type' => $this->type];
    }

    abstract public function validate(): bool;
    abstract protected function resolveType(): string;
    abstract public static function tableName(): string;

    protected static function boot(): void {}

    final public function getUid(): string
    {
        return $this->uid;
    }

    public static function getInstanceCount(): int
    {
        return self::$instanceCount;
    }

    protected function fill(array $attributes): static
    {
        foreach ($attributes as $key => $value) {
            $this->attributes[$key] = $value;
        }
        return $this;
    }

    public function getAttribute(string $key, mixed $default = null): mixed
    {
        return $this->attributes[$key] ?? $default;
    }

    /**
     * Returns by reference
     */
    public function &getRawRef(): mixed
    {
        return $this->raw;
    }

    /**
     * Static factory
     */
    public static function make(array $data = []): static
    {
        $instance = new static();
        return $instance->fill($data);
    }
}

// ── Concrete Classes ──────────────────────────────────────────────────────────

/**
 * Final class with promoted constructor, all PHP 8.x features
 *
 * @template-implements RepositoryInterface<User>
 */
#[Entity(table: 'users', timestamps: true)]
final class User extends BaseModel implements EntityInterface, Countable
{
    use AuditTrait;

    // Class constants
    public    const TABLE       = 'users';
    protected const CACHE_TTL   = 3600;
    private   const BCRYPT_COST = 12;

    // Promoted + regular constructor mix
    public function __construct(
        #[Validate('required|email')]
        public    readonly string   $email,

        #[Validate('required|min:2')]
        public    readonly string   $name,

        protected ?string           $passwordHash   = null,
        private   Status            $status         = Status::DRAFT,
        public    readonly int      $roleId         = 1,
        public    int               $loginCount     = 0,
        readonly  public  Priority  $priority       = Priority::LOW,
    ) {
        parent::__construct();
    }

    // ── Interface implementations ────────────────────────────────────────────

    public function getId(): int        { return $this->id; }
    public function getUuid(): string   { return $this->uid; }
    public function __toString(): string { return $this->email; }

    public function toArray(): array
    {
        return [
            'id'     => $this->id,
            'email'  => $this->email,
            'name'   => $this->name,
            'status' => $this->status->value,
        ];
    }

    public function fromArray(array $data): static
    {
        return new static(
            email:  $data['email'],
            name:   $data['name'],
        );
    }

    public function count(): int
    {
        return $this->loginCount;
    }

    public function validate(): bool
    {
        return filter_var($this->email, FILTER_VALIDATE_EMAIL) !== false;
    }

    protected function resolveType(): string { return 'user'; }

    public static function tableName(): string { return self::TABLE; }

    protected function getLogChannel(): string { return 'user'; }

    // ── All return-type forms ────────────────────────────────────────────────

    public function getStatus(): Status               { return $this->status; }
    public function getEmail(): string                { return $this->email; }
    public function getMaybeEmail(): ?string          { return $this->email ?: null; }
    public function getIdOrEmail(): int|string        { return $this->id ?: $this->email; }
    public function getIterableIds(): iterable        { yield $this->id; }

    // ── Parameter variety ────────────────────────────────────────────────────

    /** Variadic */
    public function addRoles(int ...$roleIds): void
    {
        foreach ($roleIds as $rid) {
            $this->attributes['roles'][] = $rid;
        }
    }

    /** Reference parameter */
    public function normalizeEmail(string &$email): void
    {
        $email = strtolower(trim($email));
    }

    /** Nullable + default */
    public function setAvatar(?string $url = null, int $size = 128): void
    {
        $this->attributes['avatar']      = $url;
        $this->attributes['avatar_size'] = $size;
    }

    /** Intersection type */
    public function processCollection(Countable&IteratorAggregate $col): int
    {
        return count($col);
    }

    /** Union type parameter */
    public function setExternalId(string|int $id): void
    {
        $this->externalId = $id;
    }

    /** Named arguments example */
    public function update(
        string  $name,
        ?string $email    = null,
        bool    $validate = true,
    ): bool {
        return $validate ? $this->validate() : true;
    }

    // ── Static methods ───────────────────────────────────────────────────────

    public static function create(array $data): self
    {
        return new self(
            email:    $data['email'],
            name:     $data['name'],
            priority: Priority::MEDIUM,
        );
    }

    public static function &getRegistry(): array
    {
        return self::$registry;
    }

    // ── Generator ────────────────────────────────────────────────────────────

    public function permissions(): Generator
    {
        yield 'read';
        yield 'write';
        yield from ['delete', 'admin'];
    }

    // ── Closures inside method ────────────────────────────────────────────────

    public function closureVariety(): void
    {
        // Regular closure with use
        $multiplier = 3;
        $triple = function (int $n) use ($multiplier): int {
            return $n * $multiplier;
        };

        // Static closure
        $upper = static function (string $s): string {
            return strtoupper($s);
        };

        // Arrow function
        $double = fn(int $x): int => $x * 2;

        // Arrow function capturing outer
        $base  = 100;
        $adder = fn(int $x): int => $x + $base;

        // Nested closure
        $outer = function (int $x) use ($triple): Closure {
            return function (int $y) use ($x, $triple): int {
                return $triple($x) + $y;
            };
        };

        // Closure returning closure (currying)
        $curry = fn(int $a) => fn(int $b) => $a + $b;

        // Immediately-invoked
        $result = (function (string $msg): string {
            return strtoupper($msg);
        })('hello');
    }
}

/**
 * Abstract generic-style collection
 *
 * @template TKey of array-key
 * @template TValue
 */
abstract class AbstractCollection implements ArrayAccess, Countable, IteratorAggregate
{
    /** @var array<TKey, TValue> */
    protected array $items = [];

    public function offsetExists(mixed $offset): bool  { return isset($this->items[$offset]); }
    public function offsetGet(mixed $offset): mixed    { return $this->items[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void
    {
        if ($offset === null) $this->items[] = $value;
        else                  $this->items[$offset] = $value;
    }
    public function offsetUnset(mixed $offset): void   { unset($this->items[$offset]); }
    public function count(): int                       { return count($this->items); }
    public function getIterator(): ArrayIterator       { return new ArrayIterator($this->items); }

    abstract public function add(mixed $item): void;

    /** @return TValue|null */
    public function first(): mixed { return $this->items[array_key_first($this->items)] ?? null; }

    /** @return TValue|null */
    public function last(): mixed  { return $this->items[array_key_last($this->items)] ?? null; }

    /** @return static */
    public function filter(Closure $predicate): static
    {
        $new = clone $this;
        $new->items = array_values(array_filter($this->items, $predicate));
        return $new;
    }

    /** @return static */
    public function map(Closure $transform): static
    {
        $new = clone $this;
        $new->items = array_map($transform, $this->items);
        return $new;
    }
}

/**
 * Concrete typed collection
 *
 * @extends AbstractCollection<int, User>
 */
class UserCollection extends AbstractCollection
{
    public function add(mixed $item): void
    {
        if (!$item instanceof User) {
            throw new InvalidArgumentException('Expected User instance');
        }
        $this->items[] = $item;
    }

    public function findByEmail(string $email): ?User
    {
        foreach ($this->items as $user) {
            if ($user->email === $email) return $user;
        }
        return null;
    }
}

/**
 * Readonly class (PHP 8.2)
 */
readonly class ValueObject
{
    public function __construct(
        public string $value,
        public string $type,
        public bool   $immutable = true,
    ) {}

    public function equals(self $other): bool
    {
        return $this->value === $other->value && $this->type === $other->type;
    }

    public function withValue(string $value): self
    {
        return new self($value, $this->type, $this->immutable);
    }
}

/**
 * Class with all magic methods
 */
class MagicClass
{
    private array  $data    = [];
    private array  $methods = [];
    private static array $instances = [];

    public function __get(string $name): mixed          { return $this->data[$name] ?? null; }
    public function __set(string $name, mixed $val): void { $this->data[$name] = $val; }
    public function __isset(string $name): bool         { return isset($this->data[$name]); }
    public function __unset(string $name): void         { unset($this->data[$name]); }
    public function __invoke(mixed ...$args): mixed     { return $args; }

    public function __call(string $name, array $args): mixed
    {
        if (isset($this->methods[$name])) {
            return ($this->methods[$name])(...$args);
        }
        throw new \BadMethodCallException("Method {$name} not found");
    }

    public static function __callStatic(string $name, array $args): mixed
    {
        return null;
    }

    public function __serialize(): array     { return $this->data; }
    public function __unserialize(array $d): void { $this->data = $d; }
    public function __sleep(): array         { return ['data']; }
    public function __wakeup(): void         { /* restore state */ }

    public static function __set_state(array $properties): static
    {
        $obj = new static();
        foreach ($properties as $k => $v) $obj->$k = $v;
        return $obj;
    }
}

/**
 * Exception hierarchy
 */
class AppException extends RuntimeException
{
    public function __construct(
        string          $message,
        private string  $context   = '',
        int             $code      = 0,
        ?\Throwable     $previous  = null,
    ) {
        parent::__construct($message, $code, $previous);
    }

    public function getContext(): string { return $this->context; }
}

class ValidationException extends AppException
{
    /** @var array<string, string[]> */
    private array $errors;

    public function __construct(array $errors, string $context = '')
    {
        $this->errors = $errors;
        parent::__construct('Validation failed', $context);
    }

    /** @return array<string, string[]> */
    public function getErrors(): array { return $this->errors; }
}

class NotFoundException extends AppException
{
    public function __construct(string $resource, int|string $id)
    {
        parent::__construct("{$resource} #{$id} not found", $resource, 404);
    }
}

/**
 * Fiber example (PHP 8.1)
 */
class FiberDemo
{
    public function createFiber(): Fiber
    {
        return new Fiber(function (): void {
            $value = Fiber::suspend('first');
            echo "Got: {$value}" . PHP_EOL;
            Fiber::suspend('second');
        });
    }

    public function runFiber(Fiber $fiber): void
    {
        $v1 = $fiber->start();
        $v2 = $fiber->resume('hello');
    }
}

/**
 * First-class callable syntax (PHP 8.1)
 */
class CallableDemo
{
    public static function staticMethod(int $x): int { return $x * 2; }
    public function instanceMethod(int $x): int      { return $x + 1; }

    public function getCallables(): array
    {
        return [
            'static'   => self::staticMethod(...),
            'instance' => $this->instanceMethod(...),
            'strlen'   => strlen(...),
            'closure'  => (fn(int $x): int => $x ** 2)(...),
        ];
    }
}

/**
 * Intersection types fully exercised
 */
class IntersectionDemo
{
    public function process(Countable&IteratorAggregate $col): Countable&IteratorAggregate
    {
        return $col;
    }

    public function log(Stringable&\Throwable $error): void
    {
        echo $error . PHP_EOL;
    }

    private function wrap(
        Countable&IteratorAggregate&ArrayAccess $storage,
        Stringable&\JsonSerializable $payload,
    ): void {}
}

// ── Anonymous class ───────────────────────────────────────────────────────────

$anonymousUser = new class ('anon@example.com', 'Anonymous') extends User {
    public function validate(): bool { return true; }
    protected function resolveType(): string { return 'anon'; }
    public static function tableName(): string { return 'anon_users'; }
    protected function getLogChannel(): string { return 'anon'; }
};

// Anonymous class implementing interface
$anonymousRepo = new class implements RepositoryInterface {
    private array $store = [];
    public function find(int $id): ?object       { return $this->store[$id] ?? null; }
    public function save(object $e): bool         { $this->store[$e->getId()] = $e; return true; }
    public function delete(int $id): bool         { unset($this->store[$id]); return true; }
    public function findAll(): array              { return array_values($this->store); }
    public function cursor(): iterable            { yield from $this->store; }
};

// ── Global Functions ──────────────────────────────────────────────────────────

/**
 * Basic typed function
 */
function createUser(string $email, string $name): User
{
    return User::create(['email' => $email, 'name' => $name]);
}

/**
 * Nullable param + return
 */
function findUserById(?int $id = null): ?User
{
    return null;
}

/**
 * Union param + return
 */
function coerce(string|int|float $value): string|int
{
    return is_float($value) ? (int) $value : $value;
}

/**
 * Intersection param
 */
function processCountableIterable(Countable&IteratorAggregate $col): int
{
    return count($col);
}

/**
 * Variadic
 */
function sumAll(float ...$values): float
{
    return array_sum($values);
}

/**
 * By-reference param
 */
function trimInPlace(string &$str): void
{
    $str = trim($str);
}

/**
 * Returns by reference
 */
function &getGlobalBuffer(): string
{
    static $buffer = '';
    return $buffer;
}

/**
 * Never return type
 */
function bail(string $message): never
{
    throw new AppException($message);
}

/**
 * With attribute
 */
#[Route('/health', method: 'GET')]
function healthCheck(): bool
{
    return true;
}

/**
 * Recursive function
 */
function fibonacci(int $n): int
{
    if ($n <= 1) return $n;
    return fibonacci($n - 1) + fibonacci($n - 2);
}

/**
 * Generator function
 */
function rangeGenerator(int $start, int $end, int $step = 1): Generator
{
    for ($i = $start; $i <= $end; $i += $step) {
        yield $i => $i * $i;
    }
}

/**
 * Higher-order function
 */
function pipe(mixed $value, callable ...$fns): mixed
{
    return array_reduce($fns, fn($carry, $fn) => $fn($carry), $value);
}

/**
 * Multiple return types via match
 */
function classify(mixed $value): string
{
    return match (true) {
        is_int($value)    => 'integer',
        is_float($value)  => 'float',
        is_string($value) => 'string',
        is_array($value)  => 'array',
        is_null($value)   => 'null',
        is_bool($value)   => 'boolean',
        default           => 'unknown',
    };
}

// ── Closures assigned at file scope ──────────────────────────────────────────

/** Regular closure */
$greet = function (string $name, string $greeting = 'Hello'): string {
    return "{$greeting}, {$name}!";
};

/** Static closure */
$staticGreet = static function (string $name): string {
    return "Hi, {$name}!";
};

/** Arrow function */
$square = fn(int $x): int => $x ** 2;

/** Arrow function with union return */
$identity = fn(string|int $x): string|int => $x;

/** Multi-param arrow */
$add = fn(int $a, int $b): int => $a + $b;

/** Nullable arrow */
$maybeUpper = fn(?string $s): ?string => $s !== null ? strtoupper($s) : null;

/** Closure with use by value */
$threshold = 100;
$exceedsThreshold = function (int $n) use ($threshold): bool {
    return $n > $threshold;
};

/** Closure with use by reference */
$counter = 0;
$increment = function (int $by = 1) use (&$counter): void {
    $counter += $by;
};

/** Closure returning closure */
$multiplierFactory = function (int $factor): Closure {
    return fn(int $x): int => $x * $factor;
};

/** Arrow function with no params */
$getVersion = fn(): string => APP_VERSION;

/** Immediately-invoked closure */
$appName = (function (): string {
    return 'FullTestApp';
})();

/** Closure assigned from static method */
$createUserClosure = User::create(...);

// ── Complex expressions ───────────────────────────────────────────────────────

// Ternary
$label = Status::ACTIVE->label() ?: 'unknown';

// Null coalescing
$env = $_ENV['APP_ENV'] ?? 'production';

// Null coalescing assignment
$config = [];
$config['debug'] ??= false;

// Match expression
$httpText = match (200) {
    200, 201 => 'Success',
    301, 302 => 'Redirect',
    404      => 'Not Found',
    500      => 'Server Error',
    default  => 'Unknown',
};

// Nested match
$priority = match (Status::ACTIVE) {
    Status::DRAFT, Status::PENDING => match (Priority::LOW) {
        Priority::LOW    => 'low-draft',
        Priority::MEDIUM => 'medium-draft',
        default          => 'other-draft',
    },
    Status::ACTIVE => 'active',
    default        => 'other',
};

// Spread operator
$first  = [1, 2, 3];
$second = [4, 5, 6];
$merged = [...$first, ...$second];

// Named arguments
$user = User::create(
    data: ['email' => 'test@test.com', 'name' => 'Tester'],
);

// Nullsafe chain
$avatar = $user?->getAttribute('avatar') ?? 'default.png';

// Elvis / short ternary
$displayName = $user->getAttribute('nickname') ?: $user->name;

// String interpolation
$info = "User {$user->name} has status {$user->getStatus()->value}";

// Heredoc
$heredocStr = <<<EOT
    User: {$user->name}
    Email: {$user->email}
    Status: {$user->getStatus()->value}
EOT;

// Nowdoc
$nowdocStr = <<<'EOT'
    This is a $nowdoc string.
    No variable interpolation: {$user->name}
EOT;

// Complex array destructuring
$coords = [[1, 2], [3, 4], [5, 6]];
[[$x1, $y1], [$x2, $y2]] = $coords;

// List with keys
$record = ['id' => 1, 'name' => 'Alice', 'email' => 'alice@example.com'];
['id' => $rid, 'name' => $rname] = $record;

// Bitwise
$flags    = 0b1010 | 0b0101;
$masked   = $flags & 0xFF;
$shifted  = 1 << 4;
$xored    = 0b1111 ^ 0b1010;

// Instanceof check
$isUser = $user instanceof User;
$isBase = $user instanceof BaseModel;
$isCountable = $user instanceof Countable;

// Type casting
$intVal   = (int)    '42';
$floatVal = (float)  '3.14';
$strVal   = (string) 42;
$boolVal  = (bool)   1;
$arrVal   = (array)  'single';

// try/catch/finally with multiple catch types
try {
    $found = $anonymousRepo->find(99);
    if (!$found) throw new NotFoundException('User', 99);
} catch (NotFoundException $e) {
    echo $e->getMessage();
} catch (ValidationException | AppException $e) {
    echo $e->getContext();
} catch (\Throwable $e) {
    echo $e->getMessage();
} finally {
    // always runs
}

// match with no-match exception
try {
    $val = match ('x') {
        'a' => 1,
        'b' => 2,
    };
} catch (\UnhandledMatchError $e) {
    // PHP 8 UnhandledMatchError
}

// Fiber usage
$fiberDemo = new FiberDemo();
$fiber     = $fiberDemo->createFiber();
$fiberDemo->runFiber($fiber);

// WeakReference
$weakRef = WeakReference::create($user);
$derefed = $weakRef->get();

// First-class callables
$callable = strlen(...);
$mapped   = array_map(strtoupper(...), ['hello', 'world']);
$filtered = array_filter([1, 2, 3, 4], fn(int $n): bool => $n % 2 === 0);

// Enum in match
$dirResult = match (Direction::NORTH) {
    Direction::NORTH, Direction::SOUTH => 'vertical',
    Direction::EAST,  Direction::WEST  => 'horizontal',
};

// Enum methods
$opposite  = Direction::NORTH->opposite();
$statusStr = Status::ACTIVE->label();
$isTerminal = Status::DELETED->isTerminal();
$fromLabel  = Status::fromLabel('Active');

// Static property access on enum
$defaultStatus = Status::DEFAULT;

// Backed enum from/tryFrom
$statusFromVal = Status::from('active');
$maybePriority = Priority::tryFrom(999);

// Readonly class
$vo1 = new ValueObject('hello', 'greeting');
$vo2 = $vo1->withValue('world');
$equal = $vo1->equals($vo2);

// SplStack usage
$stack = new SplStack();
$stack->push('first');
$stack->push('second');
$top = $stack->top();

// Complex generator usage
$gen = rangeGenerator(1, 10, 2);
foreach ($gen as $index => $squared) {
    // $index = 1,3,5,7,9 ; $squared = 1,9,25,49,81
}

// pipe higher-order
$result = pipe(
    '  hello world  ',
    trim(...),
    strtoupper(...),
    fn(string $s): string => str_replace(' ', '_', $s),
);