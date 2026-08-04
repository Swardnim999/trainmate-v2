import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Train, AlertTriangle } from 'lucide-react';

interface TrainSuggestion {
  train_number: string;
  train_name: string;
}

interface TrainAutocompleteProps {
  value: string;
  trainName: string;
  onChange: (trainNumber: string, trainName: string, isVerified: boolean) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export const TrainAutocomplete = ({
  value,
  trainName,
  onChange,
  placeholder = "Enter train number or name",
  required = false,
  className
}: TrainAutocompleteProps) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<TrainSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isVerified, setIsVerified] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputValueRef = useRef('');
  const isVerifiedRef = useRef(true);

  // Keep refs in sync with latest state for blur-timeout safety
  useEffect(() => { inputValueRef.current = inputValue; }, [inputValue]);
  useEffect(() => { isVerifiedRef.current = isVerified; }, [isVerified]);


  // Initialize input value from props
  useEffect(() => {
    if (value && trainName) {
      const displayValue = `${value} — ${trainName}`;
      inputValueRef.current = displayValue;
      isVerifiedRef.current = true;
      setInputValue(displayValue);
      setIsVerified(true);
    } else if (value) {
      inputValueRef.current = value;
      setInputValue(value);
    } else {
      inputValueRef.current = '';
      isVerifiedRef.current = true;
      setInputValue('');
      setIsVerified(true);
    }
  }, [value, trainName]);

  const searchTrains = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('trains')
        .select('train_number, train_name')
        .eq('active', true)
        .or(`train_number.ilike.%${query}%,train_name.ilike.%${query}%`)
        .limit(15);

      if (error) throw error;
      setSuggestions(data || []);
    } catch (error) {
      console.error('Error searching trains:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputValue && !inputValue.includes(' — ')) {
        searchTrains(inputValue);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, searchTrains]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    inputValueRef.current = newValue;
    setInputValue(newValue);
    setShowSuggestions(true);
    setHighlightedIndex(-1);

    if (!newValue) {
      isVerifiedRef.current = true;
      setIsVerified(true);
      onChange('', '', true);
      return;
    }

    // Check if this is a verified train
    if (!newValue.includes(' — ')) {
      isVerifiedRef.current = false;
      setIsVerified(false);
      // Extract train number if user types just a number
      const trainNum = newValue.trim();
      onChange(trainNum, '', false);
    }
  };

  const handleSelectSuggestion = (suggestion: TrainSuggestion) => {
    const displayValue = `${suggestion.train_number} — ${suggestion.train_name}`;
    inputValueRef.current = displayValue;
    isVerifiedRef.current = true;
    setInputValue(displayValue);
    setShowSuggestions(false);
    setIsVerified(true);
    onChange(suggestion.train_number, suggestion.train_name, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        // Allow form submission with unverified train
        const trainNum = inputValue.split(' — ')[0].trim();
        if (trainNum) {
          onChange(trainNum, '', false);
        }
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          handleSelectSuggestion(suggestions[highlightedIndex]);
        } else {
          // Submit with current value
          const trainNum = inputValue.split(' — ')[0].trim();
          if (trainNum) {
            onChange(trainNum, '', false);
            setShowSuggestions(false);
          }
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const handleBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => {
      setShowSuggestions(false);
      // Read latest values via refs — state may have changed due to suggestion click
      const currentInput = inputValueRef.current;
      const currentVerified = isVerifiedRef.current;
      if (currentInput && !currentVerified) {
        const trainNum = currentInput.split(' — ')[0].trim();
        if (trainNum) {
          onChange(trainNum, '', false);
        }
      }
    }, 200);
  };


  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <div className="relative">
        <Train className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => inputValue && setShowSuggestions(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          className={cn("pl-10", className)}
          autoComplete="off"
        />
      </div>
      
      <p className="text-xs text-muted-foreground mt-1">
        You can type train name or number. Can't find your train? Type it manually.
      </p>

      {/* Unverified warning */}
      {inputValue && !isVerified && !showSuggestions && (
        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          <span>Train not found in database. Entry will be saved for review.</span>
        </div>
      )}

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto"
        >
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
            Suggested trains
          </div>
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.train_number}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectSuggestion(suggestion);
              }}
              onClick={() => handleSelectSuggestion(suggestion)}
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2",
                highlightedIndex === index && "bg-accent"
              )}
            >
              <Train className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="font-medium">{suggestion.train_number}</span>
              <span className="text-muted-foreground">—</span>
              <span className="truncate">{suggestion.train_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {showSuggestions && isLoading && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
          Searching trains...
        </div>
      )}

      {/* No results */}
      {showSuggestions && !isLoading && inputValue.length >= 2 && suggestions.length === 0 && !inputValue.includes(' — ') && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
          No trains found. You can still continue with this entry.
        </div>
      )}
    </div>
  );
};
